import { motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { EASE } from './ui';

/**
 * Charts for the night surface. Series colours are a categorical palette in
 * fixed order (validated for colour-blind separation on this surface); every
 * series is also named in a legend and labelled at its end, so colour is
 * never the only way to tell them apart. Text stays in ink tokens.
 */
export type Series = { name: string; color: string; points: { x: number; y: number }[]; dashed?: boolean };

const INK = '#e9e6d8';
const MUTED = '#8b8a7c';
const GRID = '#22261d';

export function LineChart({
  series,
  height = 300,
  xLabel,
  yLabel,
  yMax,
  bands = [],
  yFormat = (v) => String(Math.round(v)),
  xFormat = (v) => String(Math.round(v)),
  hint = true,
}: {
  series: Series[];
  height?: number;
  xLabel: string;
  yLabel: string;
  yMax?: number;
  /** Horizontal reference lines, e.g. tier thresholds. */
  bands?: { y: number; label: string }[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  /** Show the read-out line under the chart. Off on slides, where nobody hovers. */
  hint?: boolean;
}) {
  const W = 720;
  const H = height;
  const pad = { l: 46, r: 132, t: 14, b: 34 };
  const ref = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const { x0, x1, y1 } = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y));
    return { x0: Math.min(...xs), x1: Math.max(...xs), y1: yMax ?? Math.max(...ys, 1) * 1.08 };
  }, [series, yMax]);
  const sx = (x: number) => pad.l + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - (y / y1) * (H - pad.t - pad.b);
  const path = (s: Series) => s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const x = x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    setHoverX(Math.max(x0, Math.min(x1, Math.round(x))));
  };
  const nearest = (s: Series, x: number) => s.points.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));

  // keep end labels from sitting on top of each other
  const ends = series
    .map((s) => ({ s, y: sy(s.points.at(-1)!.y) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i += 1) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * y1);
  return (
    <figure style={{ margin: 0 }}>
      <div className="mono mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.72rem]" style={{ color: MUTED }}>
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-2">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            <span style={{ color: INK }}>{s.name}</span>
          </span>
        ))}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" onMouseMove={onMove} onMouseLeave={() => setHoverX(null)} role="img" aria-label={`${yLabel} by ${xLabel}`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={sy(t)} fontSize={10} fill={MUTED} textAnchor="end" dominantBaseline="middle" className="mono">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {bands.map((b) => (
          <g key={b.label}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(b.y)} y2={sy(b.y)} stroke="#5d5c52" strokeWidth={1} strokeDasharray="2 4" />
            <text x={pad.l + 6} y={sy(b.y) - 5} fontSize={9.5} fill={MUTED} className="mono">
              {b.label}
            </text>
          </g>
        ))}
        {[x0, x0 + (x1 - x0) / 2, x1].map((x) => (
          <text key={x} x={sx(x)} y={H - pad.b + 16} fontSize={10} fill={MUTED} textAnchor="middle" className="mono">
            {xFormat(x)}
          </text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 2} fontSize={10} fill={MUTED} textAnchor="middle" className="mono">
          {xLabel}
        </text>
        {series.map((s, i) => (
          <motion.path
            key={s.name}
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.dashed ? '5 4' : undefined}
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.6, ease: EASE, delay: i * 0.12 }}
          />
        ))}
        {ends.map(({ s, y }) => (
          <text key={s.name} x={W - pad.r + 8} y={y} fontSize={10.5} fill={INK} dominantBaseline="middle" className="mono">
            {s.name.length > 20 ? `${s.name.slice(0, 19)}…` : s.name}
          </text>
        ))}
        {hoverX !== null && (
          <g pointerEvents="none">
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={pad.t} y2={H - pad.b} stroke="#5d5c52" strokeWidth={1} />
            {series.map((s) => {
              const p = nearest(s, hoverX);
              return <circle key={s.name} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="#10120e" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {hint && <div className="mono mt-2 text-[0.72rem]" style={{ color: MUTED, minHeight: '1.3em' }}>
        {hoverX !== null ? (
          <>
            <span style={{ color: INK }}>
              {xLabel} {xFormat(hoverX)}
            </span>
            {series.map((s) => (
              <span key={s.name}>
                {' · '}
                {s.name}: <span style={{ color: INK }}>{yFormat(nearest(s, hoverX).y)}</span>
              </span>
            ))}
          </>
        ) : (
          `Hover the chart to read values. ${yLabel}.`
        )}
      </div>}
    </figure>
  );
}

/** Horizontal bars for a handful of values on one scale. Each bar is labelled with its value. */
export function Bars({
  rows,
  format,
  max,
  color = '#3987e5',
  dark = true,
}: {
  rows: { label: string; value: number; note?: string; color?: string }[];
  format: (v: number) => string;
  max?: number;
  color?: string;
  dark?: boolean;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  const ink = dark ? INK : '#14130f';
  const muted = dark ? MUTED : '#878371';
  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` (${r.note})` : ''}`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[0.84rem]">
            <span style={{ color: ink }}>{r.label}</span>
            <span className="mono" style={{ color: ink }}>
              {format(r.value)}
              {r.note && <span style={{ color: muted }}> · {r.note}</span>}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 4, background: dark ? '#1c1f18' : '#e4ddc8', overflow: 'hidden' }}>
            <motion.div
              style={{ height: '100%', borderRadius: 4, background: r.color ?? color, transformOrigin: 'left' }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: Math.max(0.004, r.value / top) }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, ease: EASE, delay: i * 0.08 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
