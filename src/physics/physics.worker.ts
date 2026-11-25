/// <reference lib="webworker" />
/**
 * Web Worker physique : boucle à pas fixe 240 Hz (RK4) totalement découplée du rendu.
 * Publication de l'état :
 *  - SharedArrayBuffer (anneau de RING snapshots + seqlock) si disponible ;
 *  - sinon postMessage de Float64Array transférés, recyclés via un pool (zéro allocation).
 */
import { buildSpec } from '../aircraft/mods';
import { computeDerivatives } from '../cfd/derivatives';
import { FlightModel } from './flightModel';
import { IN_SIZE, OUT_SIZE, RING, sabViews, type SabViews, I } from './layout';
import type { FromWorker, ToWorker } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const DT = 1 / 240;
const MAX_STEPS = 24;

let model: FlightModel | null = null;
let views: SabViews | null = null;
let input = new Float64Array(IN_SIZE);
const pool: Float64Array[] = [];
let running = false;
let acc = 0;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const scratch = new Float64Array(OUT_SIZE);

function post(msg: FromWorker, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer ?? []);
}

function now(): number {
  return performance.timeOrigin + performance.now();
}

function publish(m: FlightModel): void {
  if (views) {
    const seq = Atomics.load(views.header, 0);
    const slot = seq % RING;
    m.writeOut(views.ring.subarray(slot * OUT_SIZE, (slot + 1) * OUT_SIZE), now());
    Atomics.store(views.header, 0, seq + 1);
  }
}

function tick(): void {
  if (!running || !model) return;
  const t = now();
  const scale = views ? views.input[I.TIME_SCALE] || 1 : input[I.TIME_SCALE] || 1;
  acc += Math.min(0.1, (t - last) / 1000) * scale;
  last = t;
  const inp = views ? views.input : input;
  let n = 0;
  while (acc >= DT && n < MAX_STEPS) {
    model.step(DT, inp);
    acc -= DT;
    n++;
    if (model.events.length) post({ type: 'events', events: model.events.slice() });
    publish(model);
  }
  if (n === MAX_STEPS) acc = 0; // rattrapage abandonné (onglet en arrière-plan)
  if (!views && n > 0) {
    const buf = pool.pop() ?? new Float64Array(OUT_SIZE);
    model.writeOut(buf, now());
    post({ type: 'state', buf }, [buf.buffer]);
  }
  timer = setTimeout(tick, 2);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        if (timer) clearTimeout(timer);
        const c = msg.config;
        const spec = buildSpec(c.aircraft, c.mods);
        const aero = computeDerivatives(spec, { mach: 0.2 });
        model = new FlightModel({
          spec, aero, airport: c.airport, startMode: c.startMode, fuelKg: c.fuelKg, payloadKg: c.payloadKg,
          xcgPct: c.xcgPct, wind: c.wind, deltaIsa: c.deltaIsa, seaState: c.seaState,
        });
        if (msg.sab) {
          views = sabViews(msg.sab);
          Atomics.store(views.header, 0, 0);
        } else {
          views = null;
          for (let i = 0; i < 6; i++) pool.push(new Float64Array(OUT_SIZE));
        }
        // snapshot initial
        model.writeOut(scratch, now());
        if (views) publish(model);
        post({
          type: 'ready',
          info: { aero, initialThrottle: model.initialThrottle, xcg: model.xcg, mass: model.mass, mode: views ? 'sab' : 'postMessage', trimElev: model.trimBase },
        });
        running = true;
        last = now();
        acc = 0;
        tick();
        break;
      }
      case 'input':
        input = msg.data;
        break;
      case 'recycle':
        if (pool.length < 12) pool.push(msg.buf);
        break;
      case 'stop':
        running = false;
        if (timer) clearTimeout(timer);
        model = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
