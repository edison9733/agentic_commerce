import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { attacks, MAINNET_TARGET_PARAMS as P, model, PROTOCOL_FEE_BPS, score } from '@tessera/sdk';
import { SERIES } from '../lib/format';
import { Bars, LineChart, type Series } from './charts';
import { EASE } from './ui';

const USDC = 1_000_000n;
const dollars = (u: bigint) => `$${(Number(u) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * Three attacks, run live in the browser through the same model the test
 * suite checks against the deployed program. The numbers are the program's
 * arithmetic at the mainnet target parameters, not an illustration.
 */
function useRing() {
  return useMemo(() => {
    const days = 120;
    const honest = attacks.simulateHonestMerchant({ params: P, feeBps: PROTOCOL_FEE_BPS, buyers: 25, buyerTier: 3, orderSize: 40n * USDC, rating: 5, periods: days });
    const rings = [3, 6, 12].map((wallets) => ({ wallets, r: attacks.simulateRing({ params: P, feeBps: PROTOCOL_FEE_BPS, wallets, orderSize: 100n * USDC, periods: days }) }));
    const series: Series[] = [
      { name: 'Honest merchant', color: SERIES[0], points: honest.map((s) => ({ x: s.period, y: s.score })) },
      ...rings.map(({ wallets, r }, i) => ({
        name: `Ring of ${wallets}`,
        color: SERIES[i + 1]!,
        dashed: true,
        points: r.snapshots.map((s) => ({ x: s.period, y: s.score })),
      })),
    ];
    return { series, rings, honestTrusted: honest.find((s) => s.tier === 3)?.period ?? null };
  }, []);
}

function Ring() {
  const { series, rings, honestTrusted } = useRing();
  return (
    <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
      <LineChart
        series={series}
        xLabel="day"
        yLabel="Best score in the group"
        yMax={1000}
        bands={[
          { y: 750, label: 'Trusted' },
          { y: 500, label: 'Established' },
          { y: 250, label: 'Building' },
        ]}
      />
      <div className="grid content-start gap-4 text-[0.92rem] leading-relaxed" style={{ color: '#c9c6b6' }}>
        <p>
          A ring is one person running many wallets that only trade with each other and rate each other five stars. It is the cheapest way to farm a reputation, so it is the one to price. The honest merchant here has 25 real customers who are themselves Trusted.
        </p>
        <table className="mono w-full text-[0.76rem]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#8b8a7c', textAlign: 'left' }}>
              <th className="py-1.5 font-normal">wallets</th>
              <th className="py-1.5 font-normal">Trusted on</th>
              <th className="py-1.5 font-normal text-right">fees burned</th>
              <th className="py-1.5 font-normal text-right">can take</th>
            </tr>
          </thead>
          <tbody>
            {rings.map(({ wallets, r }) => (
              <tr key={wallets} style={{ borderTop: '1px solid #22261d', color: '#e9e6d8' }}>
                <td className="py-1.5">{wallets}</td>
                <td className="py-1.5">{r.trustedAt ? `day ${r.trustedAt}` : 'never'}</td>
                <td className="py-1.5 text-right">{dollars(r.fees)}</td>
                <td className="py-1.5 text-right">{dollars(r.maxInstantTake)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: '#8b8a7c' }} className="text-[0.84rem]">
          Small rings stall: wallets nobody else trades with count for little, and each pair is capped. A ring big enough to reach Trusted needs at least {P.tierPeriods[2]} active days
          {honestTrusted ? ` (an honest merchant with real customers gets there on day ${honestTrusted})` : ''}, and what it can then take without a hold is the fees it already burned plus ${Number(P.instantBase / USDC)} per wallet.
        </p>
      </div>
    </div>
  );
}

function ExitScam() {
  const rows = [0n, 100n, 1_000n, 10_000n].map((fees) => {
    const b = attacks.exitScamBound(P, fees * USDC);
    return { fees, ...b };
  });
  const max = Number(rows.at(-1)!.take);
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <div className="grid gap-6">
        {rows.map((r) => (
          <div key={String(r.fees)}>
            <div className="mono mb-2 text-[0.74rem]" style={{ color: '#8b8a7c' }}>
              merchant that has paid {dollars(r.sunk)} in fees
            </div>
            <Bars
              max={max}
              format={(v) => dollars(BigInt(Math.round(v)))}
              rows={[
                { label: 'Can take instantly, then vanish', value: Number(r.take), color: SERIES[1] },
                { label: 'Already burned to get there', value: Number(r.sunk), color: SERIES[0] },
              ]}
            />
            <div className="mono mt-1.5 text-[0.76rem]" style={{ color: '#e9e6d8' }}>
              net of the scam: {dollars(r.net)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid content-start gap-4 text-[0.92rem] leading-relaxed" style={{ color: '#c9c6b6' }}>
        <p>
          Instant settlement is the one place a buyer has no hold to dispute in. So the program caps it: a merchant may carry instant volume that buyers have not accepted only up to the protocol fees it has paid, plus ${Number(P.instantBase / USDC)}.
        </p>
        <p>
          Fees are gone for good. Whatever a merchant can take and run with, it has already spent, less the ${Number(P.instantBase / USDC)} base. And an order a buyer rates one or two stars never stops counting against the cap, so the scam cannot be repeated.
        </p>
        <p className="mono text-[0.78rem]" style={{ color: '#8b8a7c' }}>
          net = (base + fees) − fees = base, at any size
        </p>
      </div>
    </div>
  );
}

function FriendlyFraud() {
  const story = useMemo(() => {
    const DAY = 86_400n;
    const t0 = 1_000_000n * DAY;
    const m = attacks.establishedAgent(P, 3, t0);
    const b = attacks.establishedAgent(P, 3, t0);
    const pair = model.newPair();
    for (let i = 1; i <= 3; i += 1) {
      const now = t0 + BigInt(i) * 40n * DAY;
      const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now);
      model.deliver(o, m, P, now);
      model.settle(o, b, m, pair, P, { kind: 'release' }, now);
    }
    const now = t0 + 130n * DAY;
    const before = { score: b.score, tier: b.tier };
    const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now, 3600);
    const trusted = o.pairTrusted;
    model.deliver(o, m, P, now);
    model.dispute(b, m, pair);
    model.settle(o, b, m, pair, P, { kind: 'resolve', merchantBps: 10_000 }, now);
    const after = { score: b.score, tier: b.tier };
    const next = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now + DAY);
    const healed = score.evaluate(b, P, now + 100n * DAY);
    return { before, after, trusted, nextHold: next.holdSecs, nextPair: next.pairTrusted, healed: healed.tier, merchantScore: m.score };
  }, []);
  const steps = [
    ['Three purchases, no disputes', `The buyer has bought from this merchant three times over 120 days. The pair is on record as trusted: ${story.trusted ? 'yes' : 'no'}.`],
    ['Delivery arrives; the buyer disputes anyway', 'The merchant committed a hash of the delivery on-chain before the dispute. The arbiter sees the hash, the order, and the pair history.'],
    ['The dispute fails', `Buyer score ${story.before.score} → ${story.after.score}. It is no longer Trusted, and cannot be again until the penalty has healed (100 days).`],
    ['The record stays', `This pair is never pair-trusted again. The next order between them is held for ${Math.round(story.nextHold / 3600)} h instead of settling at once. The merchant's score is untouched: ${story.merchantScore}.`],
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <ol className="grid gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {steps.map(([title, body], i) => (
          <motion.li
            key={title}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.12 }}
            className="grid gap-1 rounded-2xl p-4"
            style={{ background: '#151812', border: '1px solid #22261d', gridTemplateColumns: '2rem 1fr' }}
          >
            <span className="mono text-[0.8rem]" style={{ color: '#8b8a7c' }}>{String(i + 1).padStart(2, '0')}</span>
            <span>
              <span style={{ color: '#f1eee2' }}>{title}</span>
              <span className="mt-1 block text-[0.86rem] leading-relaxed" style={{ color: '#8b8a7c' }}>{body}</span>
            </span>
          </motion.li>
        ))}
      </ol>
      <div className="grid content-start gap-4 text-[0.92rem] leading-relaxed" style={{ color: '#c9c6b6' }}>
        <p>
          Friendly fraud is a buyer who got what it paid for and disputes anyway. Card networks answer it with evidence: Visa's Compelling Evidence 3.0 lets a merchant win a fraud dispute by showing two earlier undisputed purchases by the same buyer, 120 to 365 days old.
        </p>
        <p>
          On-chain that evidence does not have to be assembled. Every pair of wallets has an account that records their settled orders and disputes. The program reads it when it prices the next order, and the arbiter reads it when a dispute is opened.
        </p>
        <p className="text-[0.8rem]" style={{ color: '#8b8a7c' }}>
          Source for the Visa rule: Checkout.com, “Visa Compelling Evidence 3.0: New rules explained”, 30 October 2025.
        </p>
      </div>
    </div>
  );
}

const TABS = [
  ['ring', 'Wash-trading ring', Ring],
  ['exit', 'Exit scam', ExitScam],
  ['fraud', 'Friendly fraud', FriendlyFraud],
] as const;

export function AttackLab() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('ring');
  const Active = TABS.find((t) => t[0] === tab)![2];
  return (
    <div className="card-night p-6 md:p-8">
      <div className="mb-7 flex flex-wrap items-center gap-2" role="tablist" aria-label="Attack">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="relative rounded-full px-4 py-2 text-[0.9rem]"
            style={{ color: tab === id ? '#0a0b09' : '#c9c6b6', cursor: 'pointer' }}
          >
            {tab === id && <motion.span layoutId="attack-pill" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#b9f8da' }} transition={{ duration: 0.45, ease: EASE }} />}
            <span style={{ position: 'relative' }}>{label}</span>
          </button>
        ))}
        <span className="mono ml-auto text-[0.7rem]" style={{ color: '#5d5c52' }}>
          computed in your browser · mainnet target parameters
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease: EASE }}>
          <Active />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
