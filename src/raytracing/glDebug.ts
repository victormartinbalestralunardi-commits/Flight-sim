/**
 * Robustesse WebGL : capture des erreurs de compilation/liaison GLSL avec extrait de source
 * numéroté, pertes de contexte, et métriques de rendu (FPS, frame time, draw calls,
 * triangles, mémoire GPU estimée, temps GPU via EXT_disjoint_timer_query_webgl2).
 */
import * as THREE from 'three';

export interface ShaderErrorReport {
  time: number;
  stage: 'vertex' | 'fragment' | 'program';
  message: string;
  excerpt: string;
  material?: string;
}

type Listener = () => void;

class GlDiagnostics {
  errors: ShaderErrorReport[] = [];
  contextLost = false;
  gpuName = 'inconnu';
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }
  push(r: ShaderErrorReport): void {
    this.errors = [r, ...this.errors].slice(0, 20);
    console.error(`[GLSL ${r.stage}] ${r.message}\n${r.excerpt}`);
    this.emit();
  }
  setLost(v: boolean): void {
    this.contextLost = v;
    this.emit();
  }
  clear(): void {
    this.errors = [];
    this.emit();
  }
}

export const glDiagnostics = new GlDiagnostics();

/** Extrait numéroté autour des lignes fautives (format ANGLE/Mesa : « ERROR: 0:42: »). */
export function shaderExcerpt(source: string, log: string, context = 3): string {
  const lines = source.split('\n');
  const hits = new Set<number>();
  const re = /(?:ERROR|WARNING):\s*\d+:(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) hits.add(parseInt(m[1], 10));
  if (hits.size === 0) return lines.slice(0, 12).map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
  const out: string[] = [];
  for (const h of [...hits].sort((a, b) => a - b)) {
    for (let i = Math.max(1, h - context); i <= Math.min(lines.length, h + context); i++) {
      out.push(`${i === h ? '>>' : '  '}${String(i).padStart(4)}| ${lines[i - 1]}`);
    }
    out.push('    ⋯');
  }
  return out.join('\n');
}

/** Installe le gestionnaire d'erreurs GLSL et de perte de contexte sur un renderer. */
export function installGlErrorHandler(renderer: THREE.WebGLRenderer): void {
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const progLog = gl.getProgramInfoLog(program) ?? '';
    const vsLog = gl.getShaderInfoLog(vs) ?? '';
    const fsLog = gl.getShaderInfoLog(fs) ?? '';
    const vsSrc = gl.getShaderSource(vs) ?? '';
    const fsSrc = gl.getShaderSource(fs) ?? '';
    const t = performance.now();
    if (vsLog.trim()) glDiagnostics.push({ time: t, stage: 'vertex', message: vsLog.trim(), excerpt: shaderExcerpt(vsSrc, vsLog) });
    if (fsLog.trim()) glDiagnostics.push({ time: t, stage: 'fragment', message: fsLog.trim(), excerpt: shaderExcerpt(fsSrc, fsLog) });
    if (!vsLog.trim() && !fsLog.trim()) glDiagnostics.push({ time: t, stage: 'program', message: progLog.trim() || 'Échec de liaison du programme', excerpt: '' });
  };
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glDiagnostics.setLost(true);
  });
  canvas.addEventListener('webglcontextrestored', () => glDiagnostics.setLost(false));
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) glDiagnostics.gpuName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
}

export interface FrameMetrics {
  fps: number;
  frameMs: number;
  frameMsMax: number;
  gpuMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  gpuMemMB: number;
  renderScale: number;
  physicsMode: string;
}

/** Collecte des métriques par frame (moyennes glissantes, sans allocation). */
export class MetricsCollector {
  readonly m: FrameMetrics = {
    fps: 0, frameMs: 0, frameMsMax: 0, gpuMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, gpuMemMB: 0, renderScale: 1, physicsMode: '',
  };
  private last = 0;
  private acc = 0;
  private frames = 0;
  private maxMs = 0;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private query: WebGLQuery | null = null;
  private queryActive = false;

  attach(renderer: THREE.WebGLRenderer): void {
    const gl = renderer.getContext();
    if (gl instanceof WebGL2RenderingContext) {
      this.gl = gl;
      this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timerExt;
    }
  }

  beginGpu(): void {
    if (!this.gl || !this.timerExt || this.queryActive) return;
    if (!this.query) this.query = this.gl.createQuery();
    if (!this.query) return;
    this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.query);
    this.queryActive = true;
  }

  endGpu(): void {
    if (!this.gl || !this.timerExt || !this.query) return;
    if (this.queryActive) {
      this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      this.queryActive = false;
      this.pending = true;
    }
  }
  private pending = false;

  private pollGpu(): void {
    if (!this.gl || !this.query || !this.pending || !this.timerExt) return;
    const gl = this.gl;
    if (gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
      const ns = gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number;
      this.m.gpuMs = this.m.gpuMs * 0.9 + (ns / 1e6) * 0.1;
      this.pending = false;
    }
  }

  frame(renderer: THREE.WebGLRenderer, now: number): void {
    if (this.last) {
      const dt = now - this.last;
      this.acc += dt;
      this.frames++;
      if (dt > this.maxMs) this.maxMs = dt;
      if (this.acc >= 500) {
        this.m.fps = (this.frames * 1000) / this.acc;
        this.m.frameMs = this.acc / this.frames;
        this.m.frameMsMax = this.maxMs;
        this.acc = 0;
        this.frames = 0;
        this.maxMs = 0;
      }
    }
    this.last = now;
    const info = renderer.info;
    this.m.drawCalls = info.render.calls;
    this.m.triangles = info.render.triangles;
    this.m.geometries = info.memory.geometries;
    this.m.textures = info.memory.textures;
    const size = renderer.getDrawingBufferSize(TMP_V2);
    // estimation : buffers d'écran (couleur HDR + profondeur + post) + textures (~4 Mo chacune en moyenne)
    this.m.gpuMemMB = (size.x * size.y * (8 + 4 + 16)) / 1048576 + info.memory.textures * 4 + info.memory.geometries * 0.25;
    this.pollGpu();
  }
}
const TMP_V2 = new THREE.Vector2();
