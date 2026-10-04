import { useMemo, useState } from 'react';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS, score, type ScoreAgent } from '@tessera/sdk';
import { duration, usd } from '../lib/format';
import { Breakdown, ScoreGauge, TierBadge } from './ui';

/**
 * The real formula, in the browser. The sliders build an account; the gauge
 * is `score.evaluate` on it: the same integer arithmetic the program runs.
 */
export function Playground() {
  const [scale, setScale] = useState<'mainnet' | 'devnet'>('mainnet');
  const p = scale === 'mainnet' ? MAINNET_TARGET_PARAMS : DEVNET_PARAMS;
  const [credit, setCredit] = useState(35);
  const [active, setActive] = useState(40);
  const [parties, setParties] = useState(45);
  const [stars, setStars] = useState(4.6);
  const [lost, setLost] = useState(0);

  const { e, limit } = useMemo(() => {
    const period = BigInt(p.periodSecs);
    const now = 1_000_000n * period;
    const activePeriods = Math.round((active / 100) * Math.max(p.tenureFull, p.tierPeriods[2]!) * 1.2);
    const weight = p.reviewPrior * 40n;
    const a: ScoreAgent = {
      registeredAt: now - period * BigInt(activePeriods * 3),
      credit: (p.creditFull * BigInt(Math.round(credit * credit))) / 10_000n,
      counterpartyPoints: Math.round((parties / 100) * p.diversityFull * 1.1),
      activePeriods,
      feesPaid: (p.creditFull * BigInt(Math.round(credit * credit))) / 1_000_000n,
      penaltyBps: Math.min(10_000, lost * p.penaltyDisputeBps),
      penaltyPeriod: now / period,
      ratingSum: (weight * BigInt(Math.round(stars * 100))) / 100n,
      ratingWeight: weight,
    };
    return { e: score.evaluate(a, p, now), limit: score.instantLimit(a, p) };
  }, [p, credit, active, parties, stars, lost]);

  const Slider = ({ label, hint, value, set, min = 0, max = 100, step = 1, show }: { label: string; hint: string; value: number; set: (n: number) => void; min?: number; max?: number; step?: number; show: string }) => (
    <label className="block">
      <span className="flex items-baseline justify-between gap-4">
        <span className="text-[0.95rem]">{label}</span>
        <span className="mono text-[0.8rem]" style={{ color: '#4b483e' }}>{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(ev) => set(Number(ev.target.value))} className="mt-2 w-full" style={{ accentColor: '#126b4a' }} aria-label={label} />
      <span className="mt-0.5 block text-[0.78rem]" style={{ color: '#878371' }}>{hint}</span>
    </label>
  );

  return (
    <div className="card grid gap-8 p-6 md:grid-cols-[1fr_300px] md:p-8">
      <div className="grid content-start gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="eyebrow" style={{ color: '#878371' }}>Try it: build a wallet</div>
          <div className="mono flex rounded-full border p-0.5 text-[0.72rem]" style={{ borderColor: '#ded7c2' }} role="tablist" aria-label="Parameter scale">
            {(['mainnet', 'devnet'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={scale === s} onClick={() => setScale(s)} className="rounded-full px-3 py-1.5" style={{ background: scale === s ? '#14130f' : 'transparent', color: scale === s ? '#fbf8ef' : '#4b483e', cursor: 'pointer' }}>
                {s === 'mainnet' ? 'mainnet targets' : 'devnet (live)'}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Settled volume with proven counterparties" hint="Credit. Each counterparty counts for 10% to 100% by its own tier, and only up to a cap." value={credit} set={setCredit} show={`History ${(e.history / 1000).toFixed(2)}`} />
        <Slider label="Time actually spent trading" hint="Tenure. A wallet left to age earns nothing; only active periods count." value={active} set={setActive} show={`Tenure ${(e.tenure / 1000).toFixed(2)}`} />
        <Slider label="How many distinct, proven counterparties" hint="Diversity. Trading in a circle with your own wallets barely moves this." value={parties} set={setParties} show={`Diversity ${(e.diversity / 1000).toFixed(2)}`} />
        <Slider label="Average rating received" hint="Weighted by the volume each reviewer actually settled with you." value={stars} set={setStars} min={1} max={5} step={0.1} show={`${stars.toFixed(1)} ★`} />
        <Slider label="Disputes lost recently" hint="Each one takes 25% off the score and blocks Trusted until it has healed." value={lost} set={setLost} max={3} show={String(lost)} />
      </div>
      <div className="grid content-start justify-items-center gap-4 rounded-2xl p-5" style={{ background: '#f4efe0' }}>
        <ScoreGauge e={e} size={230} thresholds={p.tierScore} />
        <TierBadge tier={e.tier} />
        <div className="w-full">
          <Breakdown e={e} />
        </div>
        <dl className="mono grid w-full grid-cols-[1fr_auto] gap-y-1.5 border-t pt-4 text-[0.78rem]" style={{ borderColor: '#ded7c2' }}>
          <dt style={{ color: '#878371' }}>hold on this wallet's orders</dt>
          <dd className="text-right">{duration(p.holdSecs[e.tier]!)}</dd>
          <dt style={{ color: '#878371' }}>instant limit, if Trusted</dt>
          <dd className="text-right">{e.tier === 3 ? usd(limit) : 'not Trusted'}</dd>
        </dl>
      </div>
    </div>
  );
}
