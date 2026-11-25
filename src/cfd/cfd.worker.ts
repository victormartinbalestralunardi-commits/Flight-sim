/// <reference lib="webworker" />
/**
 * Worker CFD : exécute le solveur VLM de la soufflerie hors du thread principal.
 * Les requêtes sont coalescées (seule la plus récente est traitée) ; les lignes de courant,
 * plus coûteuses, sont calculées dans un second temps.
 */
import { runStreamlines, runTunnel, type TunnelRequest } from './tunnel';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pending: TunnelRequest | null = null;
let busy = false;

function pump(): void {
  if (busy || !pending) return;
  busy = true;
  const req = pending;
  pending = null;
  try {
    const r = runTunnel(req);
    ctx.postMessage({ type: 'tunnel', result: r });
    if (req.streamlines && !pending) {
      const s = runStreamlines(req);
      ctx.postMessage({ type: 'streamlines', result: s }, [s.points.buffer, s.speed.buffer]);
    }
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  busy = false;
  if (pending) setTimeout(pump, 0);
}

ctx.onmessage = (e: MessageEvent<{ type: 'solve'; req: TunnelRequest }>) => {
  if (e.data.type === 'solve') {
    pending = e.data.req;
    setTimeout(pump, 0);
  }
};
