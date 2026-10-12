import { useMemo, useState } from 'react';
import { MAINNET_TARGET_PARAMS as P, PROTOCOL_FEE_BPS, rewards, score, type RewardReview } from '@tessera/sdk';
import { tierName } from '../lib/format';
import { afterwards, cap, comment, fees, LABELS, recordedAt, reproduce, rows } from '../lib/rewardsDemo';
import { Choice, Control, Range } from './Playground';

const INK = '#14130f';
const MUTED = '#4b483e';
const FAINT = '#878371';
const LINE = '#ded7c2';
const GOOD = '#126b4a';
const BAD = '#b4532a';
const tone = (t: 'good' | 'bad' | 'plain') => (t === 'good' ? GOOD : t === 'bad' ? BAD : MUTED);
const RP = rewards.MAINNET_REWARD_PARAMS;
const dollars = (units: bigint) => {
  const n = Number(units) / 1e6;
  return n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`;
};

/** Order size in whole dollars from a slider position: most of the track is small orders. */
const sizeAt = (pos: number) => Math.max(1, Math.round((pos / 100) ** 2 * 1000));
const posOfSize = (usd: number) => Math.round(Math.sqrt(usd / 1000) * 100);

/**
 * What one review earns, worked out with the same functions the airdrop runs
 * (packages/sdk/src/rewards.ts), at the mainnet targets.
 */
function Calculator() {
  const [size, setSize] = useState(100);
  const [tier, setTier] = useState<0 | 1 | 2 | 3>(2);
  const [stars, setStars] = useState(5);
  const [others, setOthers] = useState(5);
  const [failed, setFailed] = useState(false);

  const out = useMemo(() => {
    const amount = BigInt(size) * 1_000_000n;
    const capped = amount < P.pairCap ? amount : P.pairCap;
    const weight = (capped * score.TIER_WEIGHT[tier]) / 100n;
    const me: RewardReview = { address: 'me', reviewer: 'me', subject: 'm', reviewerIsBuyer: true, rating: stars, weight, createdAt: 0 };
    const peers: RewardReview[] = others ? [{ address: 'o', reviewer: 'o', subject: 'm', reviewerIsBuyer: true, rating: others, weight: 1_000_000n, createdAt: 0 }] : [];
    const acc = rewards.accuracy(me, peers, { firstSeenAt: 0, before: { disputesLost: 0, missed: 0 } }, { disputesLost: failed ? 1 : 0, missed: 0 }, RP);
    const base = rewards.baseReward(weight, PROTOCOL_FEE_BPS, RP);
    const reward = (base * BigInt(acc.bps)) / 10_000n;
    const fee = (amount * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
    return { weight, acc, base, reward, fee };
  }, [size, tier, stars, others, failed]);

  const l = LABELS[out.acc.label]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="grid gap-4">
        <Control label="Order you are reviewing" value={`$${size.toLocaleString('en-US')}`} hint={`It paid a ${PROTOCOL_FEE_BPS / 100}% fee: ${dollars(out.fee)}. A review counts up to $${Number(P.pairCap / 1_000_000n)} of settled money per buyer and merchant pair.`}>
          <Range label="Order size" value={posOfSize(size)} max={100} set={(n) => setSize(sizeAt(n))} />
        </Control>
        <Control label="You are" value={tierName(tier)} hint={`${tier === 2 ? 'An' : 'A'} ${tierName(tier)} reviewer's review counts for ${score.TIER_WEIGHT[tier]}% of what settled. Brand-new wallets count for 10%, so made-up buyers earn almost nothing.`}>
          <Choice label="Your tier" value={tier} set={(t) => setTier(t)} options={[0, 1, 2, 3].map((t) => [t as 0 | 1 | 2 | 3, tierName(t)])} />
        </Control>
        <Control label="Your stars" value={`${stars} ★`} hint="The base pay is the same for 1 star or 5. Only what happens next changes it.">
          <Choice label="Your stars" value={stars} set={setStars} cols="grid-cols-5" options={[1, 2, 3, 4, 5].map((n) => [n, `${n} ★`])} />
        </Control>
        <Control label="Other buyers said" value={others ? `${others} ★` : 'nothing'} hint="The money-weighted average of other reviews of the same merchant around the same time.">
          <Choice label="Other buyers said" value={others} set={setOthers} cols="grid-cols-3 sm:grid-cols-6" options={[[0, 'nobody'], ...[1, 2, 3, 4, 5].map((n): [number, string] => [n, `${n} ★`])]} />
        </Control>
        <Control label="Then the merchant" value={failed ? 'failed' : 'stayed good'} hint="Failing means losing a dispute or missing a delivery after your review. That outweighs what anyone else said.">
          <Choice label="Then the merchant" value={failed ? 1 : 0} set={(v) => setFailed(v === 1)} cols="grid-cols-2" options={[[0, 'stayed good'], [1, 'lost a dispute or missed a delivery']]} />
        </Control>
      </div>
      <div className="grid gap-4 rounded-3xl p-6 lg:sticky lg:top-24" style={{ background: '#f4efe0' }}>
        <div className="eyebrow" style={{ color: FAINT }}>Your review earns</div>
        <div className="display text-[3.4rem] leading-none">{dollars(out.reward)}</div>
        <div className="flex items-baseline gap-3">
          <span className="display text-[1.8rem]" style={{ color: tone(l.tone) }}>{l.x}</span>
          <span className="text-[0.95rem]" style={{ color: tone(l.tone) }}>{l.short}</span>
        </div>
        <dl className="mono grid grid-cols-[1fr_auto] gap-y-1.5 border-t pt-4 text-[0.8rem]" style={{ borderColor: LINE }}>
          <dt style={{ color: FAINT }}>review weight</dt>
          <dd className="text-right">{dollars(out.weight)}</dd>
          <dt style={{ color: FAINT }}>base: a quarter of the fee rate</dt>
          <dd className="text-right">{dollars(out.base)}</dd>
          <dt style={{ color: FAINT }}>× accuracy</dt>
          <dd className="text-right">{l.x}</dd>
          <dt style={{ color: FAINT }}>share of the order's fee</dt>
          <dd className="text-right">{out.fee ? `${((Number(out.reward) / Number(out.fee)) * 100).toFixed(1)}%` : '—'}</dd>
        </dl>
        <p className="text-[0.85rem] leading-relaxed" style={{ color: MUTED }}>{rewards.ACCURACY_TEXT[out.acc.label as keyof typeof rewards.ACCURACY_TEXT]}. Judged {Math.round(RP.maturitySecs / 86_400)} days after the review.</p>
      </div>
    </div>
  );
}

/** The airdrop's rules, a recorded payout, and a calculator to play with. */
export function ReviewRewards({ calculator = true }: { calculator?: boolean }) {
  const glib = rows.filter((r) => r.subject === 'glib');
  const quill = rows.filter((r) => r.subject === 'quill');
  const Row = ({ r }: { r: (typeof rows)[number] }) => {
    const l = LABELS[r.label]!;
    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b py-3 last:border-b-0" style={{ borderColor: LINE }}>
        <div className="min-w-0">
          <span className="font-medium">{cap(r.reviewer)}</span>
          <span style={{ color: '#c98500' }}> {'★'.repeat(r.rating)}</span>
          <span style={{ color: '#d8d1bb' }}>{'★'.repeat(5 - r.rating)}</span>
          {comment(r.reviewer, r.subject) && <span className="text-[0.88rem]" style={{ color: FAINT }}> “{comment(r.reviewer, r.subject)}”</span>}
        </div>
        <div className="mono text-right text-[0.95rem]" style={{ color: r.reward === '0.00' || Number(r.reward) === 0 ? BAD : INK }}>${r.reward}</div>
        <div className="col-span-2 text-[0.82rem]" style={{ color: tone(l.tone) }}>{l.x} · {l.short}</div>
      </div>
    );
  };

  return (
    <div className="grid gap-10">
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Same pay for 1 star or 5', 'Every review that counted earns a quarter of the fee rate on the money behind it. The stars never change that, so there is no reason to inflate them.'],
          ['Judged on what happened next', 'Later, each review is checked: did the merchant go on to lose a dispute or miss a delivery, and did other buyers agree? An honest warning is paid 1.5×; praising a wallet that then failed is paid nothing.'],
          ['Faking it loses money', 'Both sides of an order can get back at most 75% of the fee it paid. Trading with your own wallets to farm rewards always costs more than it pays, and new wallets count for 10%.'],
        ].map(([h, b]) => (
          <div key={h} className="card p-6">
            <div className="display text-[1.6rem] leading-tight">{h}</div>
            <p className="mt-3 text-[0.95rem] leading-relaxed" style={{ color: MUTED }}>{b}</p>
          </div>
        ))}
      </div>

      <div className="card grid gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="display text-[1.9rem] leading-tight">A real payout</h3>
          <span className="mono text-[0.78rem]" style={{ color: FAINT }}>recorded {recordedAt} · real program, local validator</span>
        </div>
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <div className="text-[1.05rem] font-medium">Reviews of Glib</div>
            <p className="mt-1 text-[0.9rem]" style={{ color: BAD }}>{afterwards}</p>
            <div className="mt-2">{glib.map((r) => <Row key={r.reviewer} r={r} />)}</div>
          </div>
          <div>
            <div className="text-[1.05rem] font-medium">Reviews of Quill</div>
            <p className="mt-1 text-[0.9rem]" style={{ color: FAINT }}>Quill kept delivering.</p>
            <div className="mt-2">{quill.map((r) => <Row key={r.reviewer} r={r} />)}</div>
          </div>
        </div>
        <p className="text-[0.92rem] leading-relaxed" style={{ color: MUTED }}>
          Paid from the treasury on chain: <strong style={{ color: INK }}>{fees.paidToReviewers} USDC</strong> of the {fees.collected} USDC these orders paid in fees ({fees.shareOfFees}%). Reproduce: <span className="mono text-[0.82rem]">{reproduce}</span>
        </p>
      </div>

      {calculator && (
        <div className="card grid gap-6 p-5 md:p-10">
          <h3 className="display text-[1.9rem] leading-tight">Try it: what would your review earn?</h3>
          <Calculator />
        </div>
      )}
    </div>
  );
}
