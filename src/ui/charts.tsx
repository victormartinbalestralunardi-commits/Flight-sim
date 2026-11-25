/** Graphiques SVG légers (polaires, charge en envergure, analyse d'atterrissage). */
import { useMemo } from 'react';

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  label?: string;
  dashed?: boolean;
}

export function LineChart({
  series, width = 260, height = 150, xLabel, yLabel, marker, xDomain, yDomain, zeroLine = true, title,
}: {
  series: Series[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  marker?: { x: number; y: number; color?: string } | null;
  xDomain?: [number, number];
  yDomain?: [number, number];
  zeroLine?: boolean;
  title?: string;
}) {
  const pad = { l: 34, r: 8, t: title ? 18 : 8, b: 22 };
  const { xmin, xmax, ymin, ymax } = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of series) for (let i = 0; i < s.x.length; i++) {
      x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]);
      if (Number.isFinite(s.y[i])) { y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]); }
    }
    if (xDomain) [x0, x1] = xDomain;
    if (yDomain) [y0, y1] = yDomain;
    if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    const m = (y1 - y0) * 0.08;
    return { xmin: x0, xmax: x1, ymin: yDomain ? y0 : y0 - m, ymax: yDomain ? y1 : y1 + m };
  }, [series, xDomain, yDomain]);
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * W;
  const sy = (y: number) => pad.t + H - ((y - ymin) / (ymax - ymin || 1)) * H;
  const ticks = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return (
    <svg width={width} height={height} className="overflow-visible">
      {title && <text x={pad.l} y={11} fill="rgba(255,255,255,0.75)" fontSize={10} fontWeight={600}>{title}</text>}
      {ticks(ymin, ymax, 4).map((t, i) => (
        <g key={`y${i}`}>
          <line x1={pad.l} x2={pad.l + W} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.08)" />
          <text x={pad.l - 4} y={sy(t) + 3} fill="rgba(255,255,255,0.45)" fontSize={8.5} textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {ticks(xmin, xmax, 4).map((t, i) => (
        <text key={`x${i}`} x={sx(t)} y={pad.t + H + 12} fill="rgba(255,255,255,0.45)" fontSize={8.5} textAnchor="middle">{fmt(t)}</text>
      ))}
      {zeroLine && ymin < 0 && ymax > 0 && <line x1={pad.l} x2={pad.l + W} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.28)" />}
      {series.map((s, k) => {
        let d = '';
        for (let i = 0; i < s.x.length; i++) {
          if (!Number.isFinite(s.y[i])) continue;
          d += `${d ? 'L' : 'M'}${sx(s.x[i]).toFixed(1)},${sy(Math.max(ymin, Math.min(ymax, s.y[i]))).toFixed(1)}`;
        }
        return <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />;
      })}
      {marker && Number.isFinite(marker.y) && (
        <circle cx={sx(marker.x)} cy={sy(Math.max(ymin, Math.min(ymax, marker.y)))} r={4} fill={marker.color ?? '#fff'} stroke="rgba(0,0,0,0.5)" />
      )}
      {xLabel && <text x={pad.l + W} y={height - 1} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="end">{xLabel}</text>}
      {yLabel && <text x={2} y={pad.t + 2} fill="rgba(255,255,255,0.5)" fontSize={9}>{yLabel}</text>}
    </svg>
  );
}
