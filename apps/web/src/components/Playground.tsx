import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS, score, type Params } from '@tessera/sdk';
import { duration, tierName, TIER_LIGHT, usd } from '../lib/format';
import { outcome, posOf, presets, salesAt, type Wallet } from '../lib/playground';
import { ScoreGauge, TierBadge } from './ui';

const INK = '#14130f';
const MUTED = '#4b483e';
const FAINT = '#878371';
const LINE = '#ded7c2';
const GREEN = '#126b4a';

/** Whole dollars when the amounts are large, cents when they are small. */
const money = (units: bigint, p: Params) =>
  p.creditFull >= 1000n * 1_000_000n ? `$${Math.round(Number(units) / 1e6).toLocaleString('en-US')}` : usd(units);

export function Control({ label, value, hint, children }: { label: string; value: ReactNode; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-2xl border p-5" style={{ borderColor: LINE, background: '#fffdf6' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[1.05rem] font-medium">{label}</span>
        <span className="display text-[1.7rem] leading-none">{value}</span>
      </div>
      {children}
      <p className="text-[0.88rem] leading-relaxed" style={{ color: FAINT }}>{hint}</p>
    </div>
  );
}

export function Choice<T extends string | number>({ options, value, set, label, cols = 'grid-cols-2 sm:grid-cols-4' }: { options: [T, string][]; value: T; set: (v: T) => void; label: string; cols?: string }) {
  return (
    <div className={`grid gap-2 ${cols}`} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          role="radio"
          aria-checked={v === value}
          onClick={() => set(v)}
          className="rounded-xl border px-2 py-3 text-[0.9rem]"
          style={{ cursor: 'pointer', borderColor: v === value ? INK : LINE, background: v === value ? INK : 'transparent', color: v === value ? '#fbf8ef' : MUTED }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Range({ value, set, min = 0, max, step = 1, label }: { value: number; set: (n: number) => void; min?: number; max: number; step?: number; label: string }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input type="range" className="range" min={min} max={max} step={step} value={value} onChange={(ev) => set(Number(ev.target.value))} aria-label={label} style={{ '--fill': fill } as CSSProperties} />
  );
}

/**
 * The real formula, in the browser. Pick a wallet, change anything, and the
 * score on the right is `score.evaluate` on the account the program would hold.
 */
export function Playground() {
  const [scale, setScale] = useState<'mainnet' | 'devnet'>('mainnet');
  const p = scale === 'mainnet' ? MAINNET_TARGET_PARAMS : DEVNET_PARAMS;
  const list = useMemo(() => presets(p), [p]);
  const [picked, setPicked] = useState<string | null>('small');
  const [w, setW] = useState<Wallet>(() => presets(MAINNET_TARGET_PARAMS).find((x) => x.id === 'small')!.w);
  const o = useMemo(() => outcome(w, p), [w, p]);
  const { e } = o;

  const unit = p.periodSecs >= 86_400 ? 'day' : 'minute';
  const units = (n: number) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const pct = Number(score.TIER_WEIGHT[w.buyerTier]);
  const healPeriods = Math.ceil(p.penaltyDisputeBps / p.penaltyDecayBps);
  const maxBuyers = Math.max(40, Math.ceil(p.diversityFull / 40));
  const maxPeriods = p.tierPeriods[2]! * 2;

  const set = (patch: Partial<Wallet>) => {
    setW((cur) => ({ ...cur, ...patch }));
    setPicked(null);
  };
  const pick = (id: string, params = p) => {
    setW(presets(params).find((x) => x.id === id)!.w);
    setPicked(id);
  };
  const switchScale = (s: 'mainnet' | 'devnet') => {
    setScale(s);
    pick(picked ?? 'small', s === 'mainnet' ? MAINNET_TARGET_PARAMS : DEVNET_PARAMS);
  };

  // The one change from here that adds the most points: a nudge to keep playing.
  const nudge = useMemo(() => {
    const tries: [string, Partial<Wallet>][] = [
      ['Sell more', { sales: salesAt(Math.min(1000, posOf(w.sales, p) + 120), p) }],
      ['Win 5 more buyers', { buyers: Math.min(maxBuyers, w.buyers + 5) }],
      ['Sell to better-known buyers', { buyerTier: Math.min(3, w.buyerTier + 1) as Wallet['buyerTier'] }],
      [`Trade for 5 more ${unit}s`, { activePeriods: Math.min(maxPeriods, w.activePeriods + 5) }],
      ['Earn better reviews', { stars: Math.min(5, Math.round((w.stars + 0.5) * 10) / 10) }],
      ['Let a dispute heal', { disputesLost: Math.max(0, w.disputesLost - 1) }],
    ];
    let best: { text: string; patch: Partial<Wallet>; gain: number } | null = null;
    for (const [text, patch] of tries) {
      const gain = outcome({ ...w, ...patch }, p).e.score - e.score;
      if (gain > 0 && (!best || gain > best.gain)) best = { text, patch, gain };
    }
    return best;
  }, [w, p, e.score, maxBuyers, maxPeriods, unit]);

  const next = e.tier < 3 ? e.tier + 1 : null;
  const needs: string[] = [];
  if (next !== null) {
    const pts = p.tierScore[next - 1]! - e.score;
    const time = p.tierPeriods[next - 1]! - w.activePeriods;
    if (pts > 0) needs.push(`${pts} more points`);
    if (time > 0) needs.push(`${units(time)} more of trading`);
    if (next === 3 && e.behaviour < 10_000) needs.push(`a clean record (a lost dispute heals in ${units(healPeriods)})`);
  }

  const f = (n: number) => n.toFixed(2);

  return (
    <div className="card grid gap-10 p-5 md:p-10">
      {/* 1. Pick a starting wallet */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="display text-[1.9rem] leading-tight">1. Pick a wallet</h3>
          <span className="text-[0.92rem]" style={{ color: FAINT }}>Then change anything below and watch the score move.</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {list.map((x) => {
            const r = outcome(x.w, p).e;
            const on = picked === x.id;
            return (
              <button
                key={x.id}
                onClick={() => pick(x.id)}
                className="grid content-start gap-2 rounded-2xl border p-4 text-left"
                style={{ cursor: 'pointer', borderColor: on ? INK : LINE, background: on ? INK : '#fffdf6', color: on ? '#fbf8ef' : INK }}
                aria-pressed={on}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{x.title}</span>
                  <span className="mono text-[0.85rem]">{r.score}</span>
                </span>
                <span className="text-[0.85rem] leading-snug" style={{ color: on ? '#c9c6b6' : FAINT }}>{x.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:items-start">
        {/* 2. The knobs */}
        <div className="grid gap-4">
          <h3 className="display text-[1.9rem] leading-tight">2. Change anything</h3>
          {/* On a phone the score is below the knobs, so keep it in sight here. */}
          <div className="sticky top-[68px] z-10 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 lg:hidden" style={{ background: INK, color: '#fbf8ef' }} aria-live="polite">
            <span className="display text-[1.8rem] leading-none">{e.score}</span>
            <span className="mono text-[0.8rem]">{tierName(e.tier)}</span>
            <span className="mono text-[0.8rem]" style={{ color: '#c9c6b6' }}>{p.holdSecs[e.tier] ? `hold ${duration(p.holdSecs[e.tier]!)}` : 'instant'}</span>
          </div>
          <Control
            label="Total sales"
            value={money(w.sales, p)}
            hint={
              <>
                Counted: <strong style={{ color: INK }}>{money(o.counted, p)}</strong>. Each buyer counts for {pct}% of what it paid, up to {money((p.pairCap * BigInt(pct)) / 100n, p)} per buyer, so selling to yourself or one big buyer adds little.
              </>
            }
          >
            <Range label="Total sales" value={posOf(w.sales, p)} max={1000} set={(n) => set({ sales: salesAt(n, p) })} />
          </Control>
          <Control label="Different buyers" value={w.buyers} hint="More real buyers means more Diversity. A buyer counts once it has spent a tenth of the per-buyer cap.">
            <Range label="Different buyers" value={w.buyers} max={maxBuyers} set={(n) => set({ buyers: n })} />
          </Control>
          <Control label="Those buyers are" value={`${pct}%`} hint="How much each buyer counts depends on its own standing. Fresh wallets count for 10%, so fake buyers barely help.">
            <Choice label="Buyer tier" value={w.buyerTier} set={(t) => set({ buyerTier: t })} options={[0, 1, 2, 3].map((t) => [t as Wallet['buyerTier'], tierName(t)])} />
          </Control>
          <Control label={`${unit[0]!.toUpperCase()}${unit.slice(1)}s actively selling`} value={units(w.activePeriods)} hint={`Only ${unit}s with sales count. A wallet left to sit and age earns nothing.`}>
            <Range label={`${unit}s actively selling`} value={w.activePeriods} max={maxPeriods} set={(n) => set({ activePeriods: n })} />
          </Control>
          <Control
            label="Average review"
            value={<span>{w.stars.toFixed(1)} <span style={{ color: '#c98500' }}>★</span></span>}
            hint={`Reviews start from 3★ and each one weighs as much as the buyer paid, so a few reviews cannot swing it. This wallet counts as ${o.shownStars.toFixed(2)}★.`}
          >
            <Range label="Average review" value={w.stars} min={1} max={5} step={0.1} set={(n) => set({ stars: n })} />
          </Control>
          <Control label="Disputes lost recently" value={w.disputesLost} hint={`Each takes 25% off the score and blocks Trusted until it heals, which takes ${units(healPeriods)}.`}>
            <Choice label="Disputes lost" value={w.disputesLost} set={(n) => set({ disputesLost: n })} options={[0, 1, 2, 3].map((n) => [n, String(n)])} />
          </Control>
        </div>

        {/* 3. What it adds up to */}
        <div className="grid gap-5 rounded-3xl p-6 lg:sticky lg:top-24" style={{ background: '#f4efe0' }}>
          <h3 className="display text-[1.9rem] leading-tight">3. The score</h3>
          <div className="grid justify-items-center gap-2">
            <ScoreGauge e={e} size={260} thresholds={p.tierScore} />
            <TierBadge tier={e.tier} />
          </div>

          <p className="text-[1.05rem] leading-relaxed">
            {e.tier === 3 ? (
              <>Paid <strong>the moment it delivers</strong>, for up to {money(o.instantLimit, p)} of orders at once.</>
            ) : (
              <>Buyers' money is held <strong>{duration(p.holdSecs[e.tier]!)}</strong> after delivery before this wallet is paid.</>
            )}
          </p>

          <ol className="grid gap-1.5">
            {[0, 1, 2, 3].map((t) => (
              <li key={t} className="grid grid-cols-[1.2rem_1fr_auto] items-center gap-2 rounded-xl px-3 py-2 text-[0.9rem]" style={{ background: t === e.tier ? '#fffdf6' : 'transparent', outline: t === e.tier ? `1px solid ${LINE}` : 'none' }}>
                <span aria-hidden style={{ color: t <= e.tier ? TIER_LIGHT[t] : '#cfc8b2' }}>{t <= e.tier ? '●' : '○'}</span>
                <span>
                  <span className="font-medium">{tierName(t)}</span>
                  <span style={{ color: FAINT }}>{t === 0 ? ' · where everyone starts' : ` · ${p.tierScore[t - 1]}+ points, ${units(p.tierPeriods[t - 1]!)}`}</span>
                </span>
                <span className="mono text-[0.78rem]" style={{ color: MUTED }}>{p.holdSecs[t] ? `hold ${duration(p.holdSecs[t]!)}` : 'instant'}</span>
              </li>
            ))}
          </ol>

          <p className="text-[0.95rem]" style={{ color: MUTED }}>
            {next === null ? 'Top tier. Nothing left to unlock.' : <>To reach <strong style={{ color: INK }}>{tierName(next)}</strong>: {needs.join(', ')}.</>}
          </p>

          {nudge && (
            <button onClick={() => set(nudge.patch)} className="btn btn-ink justify-between" style={{ whiteSpace: 'normal' }}>
              <span>Try it: {nudge.text}</span>
              <span className="mono">+{nudge.gain}</span>
            </button>
          )}

          <pre className="mono overflow-x-auto rounded-2xl p-4 text-[0.78rem] leading-[1.9]" style={{ background: INK, color: '#e9e6d8' }}>
{`Evidence = 0.45×${f(e.history / 1000)} + 0.30×${f(e.tenure / 1000)} + 0.25×${f(e.diversity / 1000)}
         = ${f(e.evidence / 1000)}
score    = 1000 × ${f(e.evidence / 1000)} × ${f(e.rating / 1000)} × ${f(e.behaviour / 10_000)}
         = ${e.score}`}
          </pre>
          <p className="text-[0.8rem] leading-relaxed" style={{ color: FAINT }}>
            History {f(e.history / 1000)}, Tenure {f(e.tenure / 1000)} and Diversity {f(e.diversity / 1000)} make Evidence: how much is known. Rating {f(e.rating / 1000)} and Behaviour {f(e.behaviour / 10_000)} say whether it is good. Same integer maths as the program.
          </p>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-[0.82rem]" style={{ borderColor: LINE, color: FAINT }}>
            <span>Scale:</span>
            {(['mainnet', 'devnet'] as const).map((s) => (
              <button key={s} onClick={() => switchScale(s)} aria-pressed={scale === s} className="mono rounded-full border px-3 py-1" style={{ cursor: 'pointer', borderColor: scale === s ? INK : LINE, background: scale === s ? INK : 'transparent', color: scale === s ? '#fbf8ef' : MUTED }}>
                {s === 'mainnet' ? 'mainnet' : 'devnet'}
              </button>
            ))}
            <span>{scale === 'mainnet' ? 'days and dollars, the intended rules' : 'the same rules in minutes and cents, as deployed'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
