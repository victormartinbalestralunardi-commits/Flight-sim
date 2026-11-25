/**
 * Pont thread principal ⇄ worker physique.
 * - Détection automatique de SharedArrayBuffer (crossOriginIsolated) ;
 * - fallback postMessage avec Float64Array transférés et recyclés ;
 * - interpolation temporelle de l'état pour le rendu (zéro allocation par frame).
 */
import { IN_SIZE, O, OUT_SIZE, RING, sabBytes, sabViews, type SabViews, I } from './layout';
import type { FlightEvent } from './flightModel';
import type { FromWorker, ReadyInfo, SimConfig } from './protocol';

export function sharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

const DT = 1 / 240;

export class PhysicsBridge {
  private worker: Worker;
  private views: SabViews | null = null;
  readonly mode: 'sab' | 'postMessage';
  /** commandes (écrites directement dans la mémoire partagée en mode SAB) */
  readonly input: Float64Array;
  private readonly snapA = new Float64Array(OUT_SIZE);
  private readonly snapB = new Float64Array(OUT_SIZE);
  /** état interpolé pour le rendu */
  readonly state = new Float64Array(OUT_SIZE);
  /** dernier état brut */
  readonly latest = new Float64Array(OUT_SIZE);
  private prev = this.snapA;
  private curr = this.snapB;
  private haveState = 0;
  onEvents: ((ev: FlightEvent[]) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  ready: Promise<ReadyInfo>;
  private resolveReady!: (r: ReadyInfo) => void;
  private inputDirty = true;
  private inputCopy = new Float64Array(IN_SIZE);

  constructor(config: SimConfig, forceFallback = false) {
    this.worker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
    const useSab = !forceFallback && sharedMemoryAvailable();
    this.mode = useSab ? 'sab' : 'postMessage';
    let sab: SharedArrayBuffer | null = null;
    if (useSab) {
      sab = new SharedArrayBuffer(sabBytes());
      this.views = sabViews(sab);
      this.input = this.views.input;
    } else {
      this.input = new Float64Array(IN_SIZE);
    }
    this.input[I.TIME_SCALE] = 1;
    this.ready = new Promise((res) => (this.resolveReady = res));
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onError?.(e.message || 'Erreur worker physique');
    this.worker.postMessage({ type: 'init', config, sab });
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.resolveReady(msg.info);
        break;
      case 'state': {
        // échange des tampons prev/curr puis copie, et renvoi du buffer au pool du worker
        const t = this.prev;
        this.prev = this.curr;
        this.curr = t;
        this.curr.set(msg.buf);
        this.haveState = Math.min(2, this.haveState + 1);
        this.worker.postMessage({ type: 'recycle', buf: msg.buf }, [msg.buf.buffer]);
        break;
      }
      case 'events':
        this.onEvents?.(msg.events);
        break;
      case 'error':
        this.onError?.(msg.message);
        console.error('[physics worker]', msg.message);
        break;
    }
  }

  /** Signale une modification des commandes (mode postMessage). */
  markInput(): void {
    this.inputDirty = true;
  }

  /** Envoie les commandes (no-op en mode SAB : mémoire partagée). */
  flushInput(): void {
    if (this.views || !this.inputDirty) return;
    this.inputCopy.set(this.input);
    this.worker.postMessage({ type: 'input', data: this.inputCopy });
    this.inputDirty = false;
  }

  /** Lit l'anneau partagé (seqlock) → prev/curr = deux snapshots encadrant le temps cible. */
  private readRing(targetSim: number): void {
    const v = this.views!;
    for (let attempt = 0; attempt < 3; attempt++) {
      const s1 = Atomics.load(v.header, 0);
      if (s1 <= 0) return;
      const newest = s1 - 1;
      const oldest = Math.max(0, s1 - (RING - 2));
      // cherche le snapshot le plus récent dont t ≤ cible
      let k = newest;
      while (k > oldest && v.ring[(k % RING) * OUT_SIZE + O.SIM_TIME] > targetSim) k--;
      const a = Math.max(oldest, k), b = Math.min(newest, k + 1);
      this.prev.set(v.ring.subarray((a % RING) * OUT_SIZE, (a % RING + 1) * OUT_SIZE));
      this.curr.set(v.ring.subarray((b % RING) * OUT_SIZE, (b % RING + 1) * OUT_SIZE));
      const s2 = Atomics.load(v.header, 0);
      if (s2 - oldest < RING - 1) {
        this.haveState = 2;
        return;
      }
    }
  }

  /**
   * Interpole l'état au temps mural `nowMs` (performance.timeOrigin + performance.now()).
   * Retourne false tant qu'aucun état n'est disponible.
   */
  sample(nowMs: number): boolean {
    if (this.views) {
      const seq = Atomics.load(this.views.header, 0);
      if (seq <= 0) return false;
      const newestSlot = ((seq - 1) % RING) * OUT_SIZE;
      const ring = this.views.ring;
      const latestSim = ring[newestSlot + O.SIM_TIME];
      const latestWall = ring[newestSlot + O.WALL_TIME];
      const target = latestSim + Math.min(0.05, (nowMs - latestWall) / 1000) - DT;
      this.readRing(target);
      this.latest.set(ring.subarray(newestSlot, newestSlot + OUT_SIZE));
      this.blend(target);
      return true;
    }
    if (this.haveState === 0) return false;
    if (this.haveState === 1) {
      this.state.set(this.curr);
      this.latest.set(this.curr);
      return true;
    }
    this.latest.set(this.curr);
    const target = this.curr[O.SIM_TIME] + Math.min(0.05, (nowMs - this.curr[O.WALL_TIME]) / 1000) - DT * 2;
    this.blend(target);
    return true;
  }

  private blend(target: number): void {
    const a = this.prev, b = this.curr, o = this.state;
    const ta = a[O.SIM_TIME], tb = b[O.SIM_TIME];
    const f = tb > ta ? Math.min(1.25, Math.max(0, (target - ta) / (tb - ta))) : 1;
    for (let i = 0; i < OUT_SIZE; i++) o[i] = a[i] + (b[i] - a[i]) * f;
    // grandeurs discrètes : valeur la plus récente
    o[O.ON_GROUND] = b[O.ON_GROUND]; o[O.CRASHED] = b[O.CRASHED]; o[O.TD_COUNT] = b[O.TD_COUNT];
    o[O.FCS_LAW] = b[O.FCS_LAW]; o[O.AP_FLAGS] = b[O.AP_FLAGS]; o[O.ENG_RUN] = b[O.ENG_RUN]; o[O.LIGHTS] = b[O.LIGHTS];
    o[O.GPWS] = b[O.GPWS]; o[O.WIRE] = b[O.WIRE]; o[O.CAT_STATE] = b[O.CAT_STATE]; o[O.SURF_KIND] = b[O.SURF_KIND];
    // angles : interpolation sur le chemin court
    for (const k of [O.HEADING, O.CARRIER_HDG]) {
      let d = b[k] - a[k];
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      o[k] = a[k] + d * f;
    }
    // quaternion : nlerp sur l'hémisphère court
    let ax = a[O.QX], ay = a[O.QY], az = a[O.QZ], aw = a[O.QW];
    const dot = ax * b[O.QX] + ay * b[O.QY] + az * b[O.QZ] + aw * b[O.QW];
    if (dot < 0) { ax = -ax; ay = -ay; az = -az; aw = -aw; }
    const qx = ax + (b[O.QX] - ax) * f, qy = ay + (b[O.QY] - ay) * f, qz = az + (b[O.QZ] - az) * f, qw = aw + (b[O.QW] - aw) * f;
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    o[O.QX] = qx / n; o[O.QY] = qy / n; o[O.QZ] = qz / n; o[O.QW] = qw / n;
  }

  dispose(): void {
    this.worker.postMessage({ type: 'stop' });
    this.worker.terminate();
  }
}
