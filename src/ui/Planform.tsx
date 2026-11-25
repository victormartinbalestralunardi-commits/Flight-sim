/** Vue en plan d'ingénierie (SVG) : surfaces portantes, MAC, CG, foyer, train. */
import type { AircraftSpec } from '../aircraft/types';
import { computeMac } from '../aircraft/types';

export function Planform({ spec, xcg, xnp, width = 360, height = 300 }: { spec: AircraftSpec; xcg: number; xnp: number; width?: number; height?: number }) {
  const L = spec.length, B = spec.span;
  const s = Math.min((width - 20) / B, (height - 20) / L);
  // repère SVG : z → x écran, −x → y écran
  const X = (z: number) => width / 2 + z * s;
  const Y = (x: number) => 10 + -x * s;
  const polys: { d: string; role: string }[] = [];
  for (const surf of spec.surfaces) {
    if (surf.role === 'vtail') continue;
    for (const side of surf.symmetric ? [1, -1] : [1]) {
      const st = surf.stations;
      const pts: string[] = [];
      for (const p of st) pts.push(`${X(side * p.le[2])},${Y(p.le[0])}`);
      for (let i = st.length - 1; i >= 0; i--) pts.push(`${X(side * st[i].le[2])},${Y(st[i].le[0] - st[i].chord)}`);
      polys.push({ d: `M${pts.join('L')}Z`, role: surf.role });
    }
  }
  const mac = computeMac(spec.surfaces[0]);
  const f = spec.fuselage;
  return (
    <svg width={width} height={height}>
      {/* fuselage */}
      <ellipse cx={X(0)} cy={Y(-f.length / 2)} rx={(f.width / 2) * s} ry={(f.length / 2) * s} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" />
      {polys.map((p, i) => (
        <path key={i} d={p.d} fill={p.role === 'wing' ? 'rgba(100,210,255,0.18)' : 'rgba(191,90,242,0.2)'} stroke={p.role === 'wing' ? '#64d2ff' : '#bf5af2'} strokeWidth={1.2} />
      ))}
      {/* MAC */}
      <line x1={X(mac.yMac)} x2={X(mac.yMac)} y1={Y(mac.xLE)} y2={Y(mac.xLE - mac.mac)} stroke="#ffd60a" strokeWidth={2} />
      <text x={X(mac.yMac) + 4} y={Y(mac.xLE - mac.mac / 2)} fill="#ffd60a" fontSize={9}>MAC {mac.mac.toFixed(2)} m</text>
      {/* train */}
      {spec.gear.map((g) => <circle key={g.name} cx={X(g.pos[2])} cy={Y(g.pos[0])} r={3} fill="#8e8e93" />)}
      {/* CG et foyer */}
      <g>
        <circle cx={X(0)} cy={Y(xcg)} r={6} fill="none" stroke="#ffd23f" strokeWidth={2} />
        <path d={`M${X(0) - 6},${Y(xcg)}h12M${X(0)},${Y(xcg) - 6}v12`} stroke="#ffd23f" strokeWidth={1.5} />
        <text x={X(0) + 9} y={Y(xcg) + 3} fill="#ffd23f" fontSize={10} fontWeight={600}>CG</text>
      </g>
      <g>
        <polygon points={`${X(0)},${Y(xnp) - 6} ${X(0) + 6},${Y(xnp)} ${X(0)},${Y(xnp) + 6} ${X(0) - 6},${Y(xnp)}`} fill="#34e0ff" />
        <text x={X(0) - 10} y={Y(xnp) + 3} fill="#34e0ff" fontSize={10} fontWeight={600} textAnchor="end">Foyer</text>
      </g>
      <text x={6} y={height - 6} fill="rgba(255,255,255,0.4)" fontSize={9}>{B.toFixed(2)} m × {L.toFixed(2)} m</text>
    </svg>
  );
}
