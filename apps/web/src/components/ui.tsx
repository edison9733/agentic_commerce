import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Evaluation } from '@tessera/sdk';
import { explorerAddress, short, TIER_DARK, TIER_LIGHT, tierName } from '../lib/format';

export const EASE = [0.16, 1, 0.3, 1] as const;

export function Logo({ size = 26, invert = false }: { size?: number; invert?: boolean }) {
  // Two halves of one token: the tessera a Roman host and guest each kept.
  const ink = invert ? '#fbf8ef' : '#14130f';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M8 32a22 22 0 0 1 22-22v44A22 22 0 0 1 8 32z" fill={ink} />
      <path d="M36 10a22 22 0 0 1 0 44l6-11-6-11 6-11z" fill={invert ? '#b9f8da' : '#2f8f66'} />
    </svg>
  );
}

/** Fade and rise into view, once. */
export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose words rise in one after another. */
export function Words({ text, className, delay = 0, italic = [] }: { text: string; className?: string; delay?: number; italic?: string[] }) {
  const words = text.split(' ');
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em' }} aria-hidden>
          <motion.span
            style={{ display: 'inline-block', fontStyle: italic.includes(w.replace(/[.,]/g, '')) ? 'italic' : undefined }}
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            transition={{ duration: 1, ease: EASE, delay: delay + i * 0.07 }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** A number that counts to its value when it scrolls into view, and again when it changes. */
export function Counter({ value, format = (n) => Math.round(n).toLocaleString(), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration: 1.4, ease: EASE });
    return () => controls.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}

/** Tier as pips plus a label, so it never depends on colour alone. */
export function TierBadge({ tier, dark = false, compact = false }: { tier: number; dark?: boolean; compact?: boolean }) {
  const ramp = dark ? TIER_DARK : TIER_LIGHT;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`Tier ${tier}: ${tierName(tier)}`}>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 6,
              background: i <= tier ? ramp[tier] : 'transparent',
              boxShadow: `inset 0 0 0 1px ${i <= tier ? ramp[tier] : dark ? '#3a3f33' : '#cfc8b2'}`,
            }}
          />
        ))}
      </span>
      {!compact && <span className="mono text-[0.78rem]">{tierName(tier)}</span>}
    </span>
  );
}

export function Stars({ value, dark = false }: { value: number; dark?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const off = dark ? '#3a3f33' : '#d8d1bb';
  const on = dark ? '#c9c6b6' : '#14130f';
  return (
    <span className="inline-flex items-center gap-1.5" title={`${value.toFixed(2)} of 5`}>
      <span style={{ position: 'relative', display: 'inline-block', color: off, letterSpacing: 1, fontSize: 13, lineHeight: 1 }} aria-hidden>
        ★★★★★
        <span style={{ position: 'absolute', inset: 0, width: `${pct}%`, overflow: 'hidden', color: on, whiteSpace: 'nowrap' }}>★★★★★</span>
      </span>
      <span className="mono text-[0.78rem]">{value.toFixed(2)}</span>
    </span>
  );
}

export function Addr({ a, n = 4, className }: { a: string; n?: number; className?: string }) {
  return (
    <a href={explorerAddress(a)} target="_blank" rel="noreferrer" className={`mono link ${className ?? ''}`} title={`${a} (opens Solana Explorer)`}>
      {short(a, n)}
    </a>
  );
}

const STATE: Record<string, { label: string; color: string; icon: string }> = {
  opened: { label: 'Quoted', color: '#8b8a7c', icon: '○' },
  funded: { label: 'Funded', color: '#3987e5', icon: '◐' },
  delivered: { label: 'Held', color: '#fab219', icon: '◔' },
  released: { label: 'Released', color: '#0ca30c', icon: '●' },
  instant: { label: 'Instant', color: '#0ca30c', icon: '⚡' },
  refunded: { label: 'Refunded', color: '#ec835a', icon: '↩' },
  disputed: { label: 'Disputed', color: '#d03b3b', icon: '!' },
  resolved: { label: 'Resolved', color: '#8b8a7c', icon: '⚖' },
};

export function StateChip({ kind }: { kind: string }) {
  const s = STATE[kind] ?? STATE.opened!;
  return (
    <span className="inline-flex items-center gap-1.5 mono text-[0.72rem] whitespace-nowrap">
      <span aria-hidden style={{ color: s.color, width: 12, display: 'inline-block', textAlign: 'center' }}>{s.icon}</span>
      {s.label}
    </span>
  );
}

/**
 * The score as an arc from 0 to 1000 with the three tier thresholds marked.
 * A meter, not a chart: one number, its scale, and where the cut-offs are.
 */
export function ScoreGauge({ e, size = 220, dark = false, thresholds = [250, 500, 750] }: { e: Pick<Evaluation, 'score' | 'tier'>; size?: number; dark?: boolean; thresholds?: number[] }) {
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2 + 20;
  const start = Math.PI * 0.8;
  const sweep = Math.PI * 1.4;
  const at = (v: number, rad = r) => {
    const a = start + (sweep * v) / 1000;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as const;
  };
  const arc = (v: number) => {
    const [x0, y0] = at(0);
    const [x1, y1] = at(v);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${(sweep * v) / 1000 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ramp = dark ? TIER_DARK : TIER_LIGHT;
  const track = dark ? '#272b21' : '#e4ddc8';
  const ink = dark ? '#f1eee2' : '#14130f';
  const len = (sweep * r * e.score) / 1000;
  const [shown, setShown] = useState(e.score);
  useEffect(() => {
    const c = animate(shown, e.score, { duration: 1.1, ease: EASE, onUpdate: (v) => setShown(v) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.score]);
  return (
    <svg width={size} height={size * 0.92} viewBox={`0 0 ${size} ${size * 0.92}`} role="img" aria-label={`Score ${e.score} of 1000, ${tierName(e.tier)}`}>
      <path d={arc(1000)} fill="none" stroke={track} strokeWidth={8} strokeLinecap="round" />
      <motion.path
        d={arc(Math.max(1, e.score))}
        fill="none"
        stroke={ramp[e.tier]}
        strokeWidth={8}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: EASE }}
        key={Math.round(len)}
      />
      {thresholds.map((t) => {
        const [x0, y0] = at(t, r - 9);
        const [x1, y1] = at(t, r + 9);
        const [lx, ly] = at(t, r + 20);
        return (
          <g key={t}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={dark ? '#0a0b09' : '#fbf8ef'} strokeWidth={3} />
            <text x={lx} y={ly} fontSize={9} textAnchor="middle" dominantBaseline="middle" fill={dark ? '#8b8a7c' : '#878371'} className="mono">
              {t}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.27} fill={ink} style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
        {Math.round(shown)}
      </text>
      <text x={cx} y={cy + size * 0.13} textAnchor="middle" fontSize={11} fill={dark ? '#8b8a7c' : '#878371'} className="mono">
        {tierName(e.tier).toUpperCase()}
      </text>
    </svg>
  );
}

/** The five things the score is made of, each on its own 0..1 scale. */
export function Breakdown({ e, dark = false }: { e: Evaluation; dark?: boolean }) {
  const rows: [string, number, string][] = [
    ['History', e.history / 1000, 'settled volume, weighted by who the counterparty was'],
    ['Tenure', e.tenure / 1000, 'time, counted only while active'],
    ['Diversity', e.diversity / 1000, 'distinct counterparties, weighted by their tier'],
    ['Rating', e.rating / 1000, 'volume-weighted stars from counterparties'],
    ['Behaviour', e.behaviour / 10_000, 'falls when a dispute is lost or a delivery is missed'],
  ];
  const fill = dark ? '#4fd19a' : '#126b4a';
  return (
    <div className="grid gap-2.5">
      {rows.map(([label, v, hint], i) => (
        <div key={label} title={hint} className="grid items-center gap-3" style={{ gridTemplateColumns: '5.2rem 1fr 2.6rem' }}>
          <span className="text-[0.82rem]" style={{ color: dark ? '#c9c6b6' : '#4b483e' }}>
            {label}
          </span>
          <span style={{ height: 6, borderRadius: 6, background: dark ? '#272b21' : '#e4ddc8', overflow: 'hidden' }}>
            <motion.span
              style={{ display: 'block', height: '100%', borderRadius: 6, background: fill, transformOrigin: 'left' }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.max(0.004, v) }}
              transition={{ duration: 0.9, ease: EASE, delay: i * 0.05 }}
            />
          </span>
          <span className="mono text-[0.78rem] text-right">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <div className="display text-[2.4rem] leading-none">{children}</div>
      <div className="eyebrow mt-2 opacity-60">{label}</div>
    </div>
  );
}
