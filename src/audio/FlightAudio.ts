/**
 * Synthèse audio 100 % procédurale (Web Audio API) :
 * - piston : dents de scie à la fréquence d'allumage (4 cyl., 2 allumages/tour) + bruit modulé ;
 * - turbofan : sifflement tonal (fréquence de passage des aubes ∝ N1) + souffle filtré + grondement ;
 * - turboréacteur : rugissement filtré ∝ N1 + crépitement de postcombustion ;
 * - souffle aérodynamique ∝ pression dynamique ; avertisseur de décrochage ; GPWS (synthèse
 *   vocale) et annonces de hauteur radio ; clics cockpit ; impacts (toucher, brin, crash).
 */
import type { AircraftSpec } from '../aircraft/types';
import { O } from '../physics/layout';
import { FT } from '../physics/math';
import type { AudioSettings } from '../ui/store';

const GPWS_TEXT: Record<number, string> = { 1: 'Sink rate', 2: 'Pull up', 3: 'Too low, gear', 5: 'Bank angle', 7: 'Stall' };

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engBus!: GainNode;
  private ambBus!: GainNode;
  private alertBus!: GainNode;
  private clickBus!: GainNode;
  private noise!: AudioBuffer;
  private nodes: {
    osc?: OscillatorNode; oscGain?: GainNode; whine?: OscillatorNode; whineGain?: GainNode;
    roarFilter?: BiquadFilterNode; roarGain?: GainNode; abGain?: GainNode; abFilter?: BiquadFilterNode;
    windFilter?: BiquadFilterNode; windGain?: GainNode; stall?: OscillatorNode; stallGain?: GainNode; rumbleGain?: GainNode;
  } = {};
  private spec: AircraftSpec;
  private lastGpws = 0;
  private lastGpwsTime = 0;
  private lastCallout = 1e9;
  private t = 0;

  constructor(spec: AircraftSpec) {
    this.spec = spec;
  }

  /** Doit être appelé suite à un geste utilisateur (politique d'autoplay). */
  start(settings: AudioSettings): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.engBus = ctx.createGain(); this.engBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    this.alertBus = ctx.createGain(); this.alertBus.connect(this.master);
    this.clickBus = ctx.createGain(); this.clickBus.connect(this.master);
    this.applySettings(settings);
    // bruit blanc partagé
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start();
      return s;
    };
    const type = this.spec.engines[0].type;
    const n = this.nodes;
    if (type === 'piston') {
      n.osc = ctx.createOscillator(); n.osc.type = 'sawtooth';
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(3 * x); }
      shaper.curve = curve;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      n.oscGain = ctx.createGain(); n.oscGain.gain.value = 0;
      n.osc.connect(shaper).connect(lp).connect(n.oscGain).connect(this.engBus);
      n.osc.start();
      n.roarFilter = ctx.createBiquadFilter(); n.roarFilter.type = 'bandpass'; n.roarFilter.Q.value = 0.8;
      n.roarGain = ctx.createGain(); n.roarGain.gain.value = 0;
      noiseSrc().connect(n.roarFilter).connect(n.roarGain).connect(this.engBus);
    } else {
      n.whine = ctx.createOscillator(); n.whine.type = 'sine';
      n.whineGain = ctx.createGain(); n.whineGain.gain.value = 0;
      n.whine.connect(n.whineGain).connect(this.engBus);
      n.whine.start();
      n.roarFilter = ctx.createBiquadFilter(); n.roarFilter.type = 'lowpass'; n.roarFilter.Q.value = 0.7;
      n.roarGain = ctx.createGain(); n.roarGain.gain.value = 0;
      noiseSrc().connect(n.roarFilter).connect(n.roarGain).connect(this.engBus);
      const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 120;
      n.rumbleGain = ctx.createGain(); n.rumbleGain.gain.value = 0;
      noiseSrc().connect(rl).connect(n.rumbleGain).connect(this.engBus);
      if (this.spec.hasAfterburner) {
        n.abFilter = ctx.createBiquadFilter(); n.abFilter.type = 'bandpass'; n.abFilter.frequency.value = 180; n.abFilter.Q.value = 0.5;
        n.abGain = ctx.createGain(); n.abGain.gain.value = 0;
        noiseSrc().connect(n.abFilter).connect(n.abGain).connect(this.engBus);
      }
    }
    n.windFilter = ctx.createBiquadFilter(); n.windFilter.type = 'bandpass'; n.windFilter.Q.value = 0.6;
    n.windGain = ctx.createGain(); n.windGain.gain.value = 0;
    noiseSrc().connect(n.windFilter).connect(n.windGain).connect(this.ambBus);
    n.stall = ctx.createOscillator(); n.stall.type = 'square'; n.stall.frequency.value = 420;
    n.stallGain = ctx.createGain(); n.stallGain.gain.value = 0;
    n.stall.connect(n.stallGain).connect(this.alertBus);
    n.stall.start();
  }

  applySettings(a: AudioSettings): void {
    if (!this.ctx) return;
    this.master.gain.value = a.muted ? 0 : a.master;
    this.engBus.gain.value = a.engines;
    this.ambBus.gain.value = a.ambience;
    this.alertBus.gain.value = a.alerts;
    this.clickBus.gain.value = a.cockpit;
  }

  /** Mise à jour à chaque frame. `inside` = vue cockpit (atténuation/filtrage). */
  update(s: Float64Array, dt: number, inside: boolean, cameraDistance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.t += dt;
    const now = ctx.currentTime;
    const n = this.nodes;
    const att = inside ? 0.6 : Math.min(1, 60 / Math.max(20, cameraDistance));
    const set = (p: AudioParam | undefined, v: number, tc = 0.08) => p?.setTargetAtTime(v, now, tc);
    const n1 = s[O.N1];
    const run = s[O.ENG_RUN] !== 0;
    if (this.spec.engines[0].type === 'piston') {
      const rpm = s[O.PROP_RPM];
      set(n.osc?.frequency, Math.max(20, (rpm / 60) * 2));
      set(n.oscGain?.gain, rpm > 100 ? (0.08 + 0.18 * (s[O.THROTTLE])) * att : 0);
      set(n.roarFilter?.frequency, 200 + rpm * 0.4);
      set(n.roarGain?.gain, rpm > 100 ? 0.06 * att : 0);
    } else {
      const bpf = 400 + n1 * 3200;
      set(n.whine?.frequency, bpf);
      set(n.whineGain?.gain, n1 > 0.05 ? (0.015 + 0.03 * n1) * att * (inside ? 0.6 : 1) : 0);
      set(n.roarFilter?.frequency, 300 + n1 * 2500);
      set(n.roarGain?.gain, run || n1 > 0.05 ? (0.03 + 0.3 * n1 * n1) * att : 0);
      set(n.rumbleGain?.gain, (0.05 + 0.5 * n1 * n1) * att);
      if (n.abGain) {
        const ab = s[O.AB];
        // crépitement : modulation aléatoire de gain
        set(n.abGain.gain, ab > 0.02 ? (0.25 + 0.35 * ab) * att * (0.8 + 0.4 * Math.random()) : 0, 0.02);
      }
    }
    const q = s[O.QDYN];
    set(n.windFilter?.frequency, 300 + s[O.TAS] * 8);
    set(n.windGain?.gain, Math.min(0.5, q / 40000) * (inside ? 1 : 0.5));
    // avertisseur de décrochage
    const stall = s[O.STALL_WARN] > 0.5;
    set(n.stallGain?.gain, stall && Math.floor(this.t * 6) % 2 === 0 ? 0.08 : 0, 0.01);
    // GPWS
    const g = s[O.GPWS] | 0;
    if (g && g !== 7 && (g !== this.lastGpws || this.t - this.lastGpwsTime > 2.2)) {
      this.say(GPWS_TEXT[g] ?? '', 1.15);
      this.lastGpwsTime = this.t;
    }
    this.lastGpws = g;
    // annonces radioaltimètre (liners / bizjet)
    if (this.spec.category !== 'fighter' && s[O.VS] < -0.5 && s[O.ON_GROUND] === 0) {
      const ft = s[O.AGL] / FT;
      for (const c of [500, 100, 50, 40, 30, 20, 10]) {
        if (this.lastCallout > c && ft <= c) { this.say(String(c), 1.25); break; }
      }
      this.lastCallout = ft;
    } else if (s[O.AGL] / FT > 600) this.lastCallout = 1e9;
  }

  private say(text: string, rate: number): void {
    if (!text || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    u.volume = this.alertBus ? Math.min(1, this.alertBus.gain.value * this.master.gain.value) : 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  /** Clic mécanique cockpit / impact. */
  burst(kind: 'click' | 'thump' | 'wire' | 'crash'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    const dur = kind === 'click' ? 0.035 : kind === 'thump' ? 0.25 : kind === 'wire' ? 1.2 : 2.5;
    f.type = kind === 'click' ? 'highpass' : kind === 'wire' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'click' ? 2500 : kind === 'thump' ? 180 : kind === 'wire' ? 1400 : 400;
    const peak = kind === 'click' ? 0.5 : kind === 'crash' ? 1 : 0.7;
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(f).connect(g).connect(kind === 'click' ? this.clickBus : this.ambBus);
    src.start(now, Math.random());
    src.stop(now + dur);
  }

  dispose(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    void this.ctx?.close();
    this.ctx = null;
  }
}
