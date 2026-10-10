import { motion } from 'motion/react';
import { useMemo } from 'react';
import { attacks, MAINNET_TARGET_PARAMS as P, OrderState, PROTOCOL_FEE_BPS } from '@tessera/sdk';
import { Bars, LineChart, type Series } from '../components/charts';
import { Graph } from '../components/Graph';
import { Counter, EASE, Logo, TierBadge } from '../components/ui';
import { compactUsd, duration, SERIES, TIER_DARK } from '../lib/format';
import { ranked, recordedAt, reproduce } from '../lib/findDemo';
import * as payout from '../lib/rewardsDemo';
import { useChain, useProfiles } from '../lib/store';
import registry from '../../../../deployments/registry.json';
import snapshot from '../../../../deployments/snapshot.json';
import { Big, Body, Deck, Frame, Kicker, Rise, Source, type Slide } from './Deck';

const USDC = 1_000_000n;
const mint = '#b9f8da';
const white = '#f1eee2';

function LiveSlide() {
  const { pairs, orders, feed, config } = useChain();
  const { profiles } = useProfiles();
  const trusted = profiles.filter((p) => p.eval.tier === 3).length;
  const instant = orders.filter((o) => o.data.state === OrderState.Released && o.data.instant).length;
  const ring = profiles.find((p) => p.name === 'washer');
  const stat = (v: React.ReactNode, label: string) => (
    <div>
      <div className="display" style={{ fontSize: 76, color: white, lineHeight: 1 }}>{v}</div>
      <div className="mono" style={{ fontSize: 16, color: '#8b8a7c', marginTop: 10 }}>{label}</div>
    </div>
  );
  return (
    <Frame pad={72}>
      <Kicker>Live on Solana devnet · read from the chain while you watch</Kicker>
      <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 48, marginTop: 22, flex: 1, minHeight: 0 }}>
        <div className="card-night" style={{ overflow: 'hidden' }}>
          <Graph profiles={profiles} pairs={pairs} orders={orders} feed={feed} height={640} />
        </div>
        <div style={{ display: 'grid', alignContent: 'center', gap: 34 }}>
          <Rise delay={0.2}>{stat(<Counter value={Number(config?.ordersSettled ?? 0n)} />, 'orders settled through escrow')}</Rise>
          <Rise delay={0.35}>{stat(<Counter value={trusted} />, 'agents that have earned Trusted')}</Rise>
          <Rise delay={0.5}>{stat(<Counter value={instant} />, 'orders settled instantly')}</Rise>
          <Rise delay={0.65}>{stat(ring ? ring.eval.score : '–', `score of the wash-trading ring's merchant (${ring ? ['New', 'Building', 'Established', 'Trusted'][ring.eval.tier] : ''})`)}</Rise>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 14, color: '#5d5c52', marginTop: 14 }}>
        Demo network: this project's own agents, recycled test USDC, time compressed (one period = 60 s). {compactUsd(config?.volumeSettled ?? 0n)} settled.
      </div>
    </Frame>
  );
}

function RingSlide() {
  const { series, rows } = useMemo(() => {
    const days = 120;
    const honest = attacks.simulateHonestMerchant({ params: P, feeBps: PROTOCOL_FEE_BPS, buyers: 25, buyerTier: 3, orderSize: 40n * USDC, rating: 5, periods: days });
    const rings = [3, 6, 12].map((wallets) => ({ wallets, r: attacks.simulateRing({ params: P, feeBps: PROTOCOL_FEE_BPS, wallets, orderSize: 100n * USDC, periods: days }) }));
    const series: Series[] = [
      { name: 'Honest merchant', color: SERIES[0], points: honest.map((s) => ({ x: s.period, y: s.score })) },
      ...rings.map(({ wallets, r }, i) => ({ name: `Ring of ${wallets}`, color: SERIES[i + 1]!, dashed: true, points: r.snapshots.map((s) => ({ x: s.period, y: s.score })) })),
    ];
    return { series, rows: rings };
  }, []);
  const big = rows[2]!.r;
  return (
    <Frame pad={80}>
      <Kicker>We assumed people would cheat</Kicker>
      <Big size={66} max="24ch" color={white}>
        Faking a record takes weeks, and steals back <em>little more than it cost.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 56, marginTop: 26, alignItems: 'center' }}>
        <Rise delay={0.4}>
          <LineChart series={series} height={330} hint={false} xLabel="day" yLabel="best score in the group" yMax={1000} bands={[{ y: 750, label: 'Trusted' }]} />
        </Rise>
        <div style={{ display: 'grid', gap: 26 }}>
          <Rise delay={0.6}>
            <div className="display" style={{ fontSize: 64, color: white, lineHeight: 1 }}>never</div>
            <div style={{ fontSize: 22, marginTop: 8 }}>when a ring of 3 or 6 of your own wallets reaches Trusted, in a full simulated year (120 days shown)</div>
          </Rise>
          <Rise delay={0.75}>
            <div className="display" style={{ fontSize: 64, color: white, lineHeight: 1 }}>${Number(big.fees / USDC).toLocaleString()}</div>
            <div style={{ fontSize: 22, marginTop: 8 }}>burned in fees by a ring of 12 to get there, over {big.trustedAt} days</div>
          </Rise>
          <Rise delay={0.9}>
            <div className="display" style={{ fontSize: 64, color: mint, lineHeight: 1 }}>${Number(P.instantBase / USDC)}</div>
            <div style={{ fontSize: 22, marginTop: 8 }}>most a ring clears per wallet in an exit scam, at any size</div>
          </Rise>
        </div>
      </div>
      <Source>Computed by the same arithmetic the program runs, at the mainnet target parameters. Reproduce: npm run test:formula</Source>
    </Frame>
  );
}

/** find_merchants as recorded by `npm run demo:find`: real purchases and reviews on the real program. */
function FindSlide() {
  const rows = ranked('best');
  const regular = ranked('returning')[0]!;
  return (
    <Frame pad={84}>
      <Kicker>Reviews as search, for agents</Kicker>
      <Big size={78} max="21ch" color={white}>
        Who should I buy from? <em>One call.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 52, marginTop: 36, alignItems: 'start' }}>
        <Rise delay={0.4}>
          <div className="mono" style={{ fontSize: 21, padding: '16px 24px', borderRadius: 16, background: '#10120e', border: '1px solid #272b21', color: '#c9c6b6' }}>
            $ tessera find <span style={{ color: mint }}>text summary</span>
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {rows.map((r, k) => (
              <Rise key={r.merchant} delay={0.7 + k * 0.14}>
                <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 150px', alignItems: 'center', gap: 16, padding: '14px 22px', borderRadius: 16, border: `1px solid ${k === 0 ? mint : '#272b21'}`, background: k === 0 ? '#121a14' : '#10120e' }}>
                  <span className="display" style={{ fontSize: 34, color: k === 0 ? mint : '#8b8a7c' }}>{r.rank}</span>
                  <div>
                    <span className="display" style={{ fontSize: 34, color: white }}>{r.name}</span>
                    <div className="mono" style={{ fontSize: 16, color: '#8b8a7c', marginTop: 2 }}>
                      {r.tier} {r.score} · ★{r.stars.toFixed(2)} · {r.sales} sales{r.missedDeliveries ? <span style={{ color: '#ec835a' }}> · {r.missedDeliveries} missed delivery</span> : ''}
                    </div>
                  </div>
                  <div className="mono" style={{ textAlign: 'right', fontSize: 18, color: white }}>
                    {r.service?.price?.usdc} USDC
                    <div style={{ fontSize: 15, color: '#8b8a7c' }}>{r.decision} · ~{r.expectedSecs} s</div>
                  </div>
                </div>
              </Rise>
            ))}
          </div>
          <Rise delay={1.3}>
            <div className="mono" style={{ fontSize: 17, marginTop: 14, color: '#c9c6b6' }}>
              A regular customer asking the same: <span style={{ color: mint }}>{regular.name} · {regular.decision} · ~{regular.expectedSecs} s to settled</span>
            </div>
          </Rise>
        </Rise>
        <div style={{ display: 'grid', gap: 16 }}>
          {[
            ['Ranked by money, not words', 'Each review needed a real settled order and counts by what it paid.'],
            ['Answers the next question too', 'Every row says instant or escrow, and the seconds from paying to settled.'],
            ['Built for agents', 'Compact JSON with enums, over an API, MCP, a skill or a CLI. No pages to read.'],
          ].map(([h, b], k) => (
            <Rise key={h} delay={0.9 + k * 0.15}>
              <div style={{ padding: '18px 24px', borderRadius: 18, border: '1px solid #272b21', background: '#10120e' }}>
                <div className="display" style={{ fontSize: 32, color: white }}>{h}</div>
                <div style={{ fontSize: 21, marginTop: 6, lineHeight: 1.35, color: '#c9c6b6' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
      </div>
      <Source>Recorded {recordedAt}: twelve purchases between real agents on a local validator running the real program, then one call. Reproduce: {reproduce}</Source>
    </Frame>
  );
}

function RewardsSlide() {
  const glib = payout.rows.filter((r) => r.subject === 'glib');
  return (
    <Frame pad={84}>
      <Kicker>Reviews that pay</Kicker>
      <Big size={78} max="22ch" color={white}>
        Paid to review. <em>Paid more for being right.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 52, marginTop: 36, alignItems: 'start' }}>
        <Rise delay={0.4}>
          <div className="mono" style={{ fontSize: 19, color: '#c9c6b6', marginBottom: 12 }}>Three buyers reviewed Glib. Then Glib took an order and never delivered.</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {glib.map((r, k) => {
              const good = r.label === 'early_warning';
              return (
                <Rise key={r.reviewer} delay={0.7 + k * 0.16}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', alignItems: 'center', gap: 16, padding: '14px 22px', borderRadius: 16, border: `1px solid ${good ? mint : '#272b21'}`, background: good ? '#121a14' : '#10120e' }}>
                    <div>
                      <span className="display" style={{ fontSize: 32, color: white }}>{payout.cap(r.reviewer)}</span>
                      <span style={{ fontSize: 24, color: '#e2b04a', marginLeft: 12 }}>{'★'.repeat(r.rating)}</span>
                      <span style={{ fontSize: 24, color: '#3a3f33' }}>{'★'.repeat(5 - r.rating)}</span>
                      <div className="mono" style={{ fontSize: 16, color: good ? mint : '#ec835a', marginTop: 2 }}>{payout.LABELS[r.label]!.x} · {payout.LABELS[r.label]!.short}</div>
                    </div>
                    <div className="display" style={{ textAlign: 'right', fontSize: 40, color: good ? mint : '#8b8a7c' }}>${r.reward}</div>
                  </div>
                </Rise>
              );
            })}
          </div>
          <Rise delay={1.3}>
            <div className="mono" style={{ fontSize: 17, marginTop: 14, color: '#c9c6b6' }}>
              Paid on chain: <span style={{ color: mint }}>{payout.fees.paidToReviewers} USDC of {payout.fees.collected} USDC in fees</span>, to {payout.rows.filter((r) => Number(r.reward) > 0).length} reviews
            </div>
          </Rise>
        </Rise>
        <div style={{ display: 'grid', gap: 16 }}>
          {[
            ['Same pay for 1★ or 5★', 'A quarter of the fee rate on the money behind the review. Stars never change it.'],
            ['Judged on what happened next', 'An honest warning is paid 1.5×. Praising a wallet that then failed is paid nothing.'],
            ['Faking it loses money', 'At most 75% of an order’s fee comes back, so farming with your own wallets never pays.'],
          ].map(([h, b], k) => (
            <Rise key={h} delay={0.9 + k * 0.15}>
              <div style={{ padding: '18px 24px', borderRadius: 18, border: '1px solid #272b21', background: '#10120e' }}>
                <div className="display" style={{ fontSize: 32, color: white }}>{h}</div>
                <div style={{ fontSize: 21, marginTop: 6, lineHeight: 1.35, color: '#c9c6b6' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
      </div>
      <Source>Recorded {payout.recordedAt}: real purchases, reviews, a missed delivery and the airdrop payout, on a local validator running the real program. Reproduce: {payout.reproduce}</Source>
    </Frame>
  );
}

function ZkSlide() {
  const wallets = ['sock-1', 'sock-2', 'sock-3', 'washer'];
  const rows = [
    ['Rings collapse', "Orders between one operator's own wallets earn nothing."],
    ['Penalties stick', 'A fresh wallet still answers for the person behind it.'],
    ['Nobody learns who', 'The proof shows membership in a verified group, never which member.'],
  ];
  return (
    <Frame pad={84}>
      <Kicker>Next: proof of personhood</Kicker>
      <Big size={74} max="22ch" color={white}>
        One person, one identity. <em>However many wallets.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 64, marginTop: 44, alignItems: 'center' }}>
        <Rise delay={0.4}>
          <svg viewBox="0 0 640 380" width="100%" role="img" aria-label="Four wallets of one operator lead to a single nullifier">
            {wallets.map((w, k) => {
              const y = 40 + k * 93;
              return (
                <g key={w}>
                  <motion.line x1={92} y1={y} x2={392} y2={180} stroke="#3a4033" strokeWidth={2} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.6 + k * 0.12, ease: EASE }} />
                  <circle cx={70} cy={y} r={22} fill="#1c1f18" stroke="#8b8a7c" strokeWidth={2} />
                  <text x={70} y={y + 46} textAnchor="middle" className="mono" fontSize={15} fill="#8b8a7c">{w}</text>
                </g>
              );
            })}
            <motion.g initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 1.3, ease: EASE }} style={{ transformOrigin: '510px 180px' }}>
              <rect x={392} y={120} width={240} height={120} rx={20} fill="#121a14" stroke={mint} strokeWidth={2} />
              <text x={512} y={168} textAnchor="middle" className="mono" fontSize={18} fill={mint}>one nullifier</text>
              <text x={512} y={200} textAnchor="middle" className="mono" fontSize={14} fill="#8b8a7c">Poseidon(secret, scope)</text>
            </motion.g>
          </svg>
        </Rise>
        <div style={{ display: 'grid', gap: 16 }}>
          {rows.map(([h, b], k) => (
            <Rise key={h} delay={0.9 + k * 0.15}>
              <div style={{ padding: '20px 26px', borderRadius: 18, border: '1px solid #272b21', background: '#10120e' }}>
                <div className="display" style={{ fontSize: 36, color: white }}>{h}</div>
                <div style={{ fontSize: 22, marginTop: 6, lineHeight: 1.35, color: '#c9c6b6' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
      </div>
      <Source>Roadmap, not built. A Semaphore-style zero-knowledge proof (Groth16 over BN254, which Solana verifies with its alt_bn128 syscalls) would address two open items in docs/SECURITY.md, large rings (C2) and whitewashing (C12), but needs an issuer of operator attestations that is not designed.</Source>
    </Frame>
  );
}

function EfficiencySlide() {
  const payment = 0.07;
  const card = payment * 0.029 + 0.3;
  const label = (t: string) => <div className="mono" style={{ fontSize: 16, color: '#8b8a7c', marginBottom: 22, letterSpacing: '0.08em' }}>{t}</div>;
  return (
    <Frame pad={88}>
      <Kicker>Cheaper, and final sooner</Kicker>
      <Big size={78} max="20ch" color={white}>
        What it takes to move <em>seven cents.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 72, marginTop: 52 }}>
        <Rise delay={0.4}>
          {label('WHAT THE PAYMENT COSTS')}
          <div style={{ zoom: 1.55 }}>
            <Bars
              format={(v) => `$${v.toFixed(4)}`}
              rows={[
                { label: 'Card processor (2.9% + 30¢)', value: card, note: `${Math.round((card / payment) * 100)}%`, color: SERIES[1] },
                { label: 'Tessera escrow (1%)', value: payment * 0.01, note: '1%', color: SERIES[0] },
              ]}
            />
          </div>
        </Rise>
        <Rise delay={0.75}>
          {label('HOW LONG IT STAYS OPEN TO DISPUTE')}
          <div style={{ zoom: 1.55 }}>
            <Bars
              format={(v) => (v === 0 ? 'none' : `${v} days`)}
              rows={[
                { label: 'Card chargeback window', value: 120, color: SERIES[1] },
                { label: 'Tessera, a new wallet', value: P.holdSecs[0]! / 86_400, color: SERIES[0] },
                { label: 'Tessera, two Trusted agents', value: 0, note: 'settles with delivery', color: SERIES[0] },
              ]}
            />
          </div>
        </Rise>
      </div>
      <Body delay={1.0} size={26} max="60ch">
        The buyer pays no network fee: the x402 facilitator does. On devnet, a buyer agent's SOL balance was identical before and after its purchase.
      </Body>
      <Source>Card price: stripe.com/pricing (5 Oct 2026). Chargeback window: Stripe, “Chargeback time limits in the UK”. Tessera holds: mainnet targets.</Source>
    </Frame>
  );
}

function LayerSlide() {
  const rows = [
    { tag: 'IDENTITY', name: 'Solana Agent Registry', sub: 'ERC-8004 on Solana', what: 'Who the agent is, and what others say about it.', ours: false },
    { tag: 'CREDIT', name: 'Tessera', sub: 'escrow and an on-chain score', what: 'Whether the money waits, and for how long.', ours: true },
    { tag: 'PAYMENT', name: 'x402', sub: 'the exact scheme, unchanged', what: 'How the money moves.', ours: false },
  ];
  const mirrored = Object.keys(registry.feedback).length;
  const registered = Object.keys(registry.agents).length;
  return (
    <Frame pad={88}>
      <Kicker>Where it fits</Kicker>
      <Big size={76} max="27ch" color={white}>
        Solana has the identity and the payment. <em>This is the credit.</em>
      </Big>
      <div style={{ display: 'grid', gap: 14, marginTop: 44 }}>
        {rows.map((r, k) => (
          <Rise key={r.tag} delay={0.4 + k * 0.14}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr 1.05fr',
                alignItems: 'center',
                gap: 28,
                padding: '22px 30px',
                borderRadius: 18,
                border: `1px solid ${r.ours ? mint : '#272b21'}`,
                background: r.ours ? '#121a14' : '#10120e',
              }}
            >
              <span className="mono" style={{ fontSize: 15, color: r.ours ? mint : '#8b8a7c', letterSpacing: '0.1em' }}>{r.tag}</span>
              <span>
                <span className="display" style={{ fontSize: 42, color: r.ours ? mint : white }}>{r.name}</span>
                <span className="mono" style={{ fontSize: 15, color: '#8b8a7c', marginLeft: 16 }}>{r.sub}</span>
              </span>
              <span style={{ fontSize: 24, color: r.ours ? white : '#c9c6b6' }}>{r.what}</span>
            </div>
          </Rise>
        ))}
      </div>
      <Body delay={1.0} size={26} max="62ch">
        Our {registered} merchant agents are in the Agent Registry on devnet. Each of the {mirrored} reviews Tessera has mirrored there points at the escrow account that proves the purchase.
      </Body>
      <Source>solana.com/agent-registry. Assets and mirrored reviews: deployments/registry.json. ERC-8004: “Payments are orthogonal to this protocol and not covered here.”</Source>
    </Frame>
  );
}

function TierSlide() {
  const loop = [6.5, 3.6, 1.8, 0.7];
  return (
    <Frame pad={96}>
      <Kicker>What Tessera does</Kicker>
      <Big size={84} max="19ch" color={white}>
        Escrow that knows <em>who it is dealing with.</em>
      </Big>
      <div style={{ display: 'grid', gap: 16, marginTop: 52 }}>
        {[0, 1, 2, 3].map((t) => (
          <Rise key={t} delay={0.4 + t * 0.12}>
            <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 270px', alignItems: 'center', gap: 28, padding: '20px 26px', border: '1px solid #272b21', borderRadius: 18, background: '#10120e' }}>
              <span style={{ fontSize: 22, color: white }}><TierBadge tier={t} dark /></span>
              <div style={{ position: 'relative', height: 22 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, background: '#272b21' }} />
                <motion.div style={{ position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 18, background: TIER_DARK[t] }} animate={{ left: ['0%', 'calc(100% - 18px)'] }} transition={{ duration: loop[t], ease: t === 3 ? EASE : 'linear', repeat: Infinity, repeatDelay: 0.6 }} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="display" style={{ fontSize: 44, color: white }}>{duration(P.holdSecs[t]!)}</span>
                <span className="mono" style={{ fontSize: 14, color: '#8b8a7c' }}> hold</span>
              </div>
            </div>
          </Rise>
        ))}
      </div>
      <Source>Mainnet target holds. On devnet the same four tiers hold for 2 min, 45 s, 10 s and 0.</Source>
    </Frame>
  );
}

export const PITCH: Slide[] = [
  {
    id: 'title',
    seconds: 5,
    say: 'This is Tessera. The credit layer for agent commerce.',
    render: () => (
      <Frame center>
        <motion.div initial={{ scale: 0.6, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 1.2, ease: EASE }}>
          <Logo size={120} invert />
        </motion.div>
        <Big size={150} delay={0.4} color={white}>Tessera</Big>
        <Body delay={0.9} size={38} max="30ch">The credit layer for agent commerce.</Body>
      </Frame>
    ),
  },
  {
    id: 'hook',
    seconds: 11,
    say: 'AI agents now pay each other. x402 has carried about two hundred million payments. On one recent day, the average was seven cents.',
    render: () => (
      <Frame>
        <Kicker>It is already happening</Kicker>
        <Big size={96} max="16ch" color={white}>AI agents now <em>pay each other.</em></Big>
        <div style={{ display: 'flex', gap: 96, marginTop: 84 }}>
          <Rise delay={0.6}>
            <div className="display" style={{ fontSize: 150, color: mint, lineHeight: 1 }}>≈<Counter value={200} />M</div>
            <div style={{ fontSize: 26, marginTop: 14 }}>x402 payments so far</div>
          </Rise>
          <Rise delay={0.9}>
            <div className="display" style={{ fontSize: 150, color: white, lineHeight: 1 }}>7¢</div>
            <div style={{ fontSize: 26, marginTop: 14 }}>average payment on one recent day</div>
          </Rise>
        </div>
        <Source>Solana Foundation, 5 Aug 2026: “roughly 200 million transactions … Most transactions are under 50 cents.” x402scan.com, 24 h to 5 Oct 2026: 118,341 payments, $8.01K.</Source>
      </Frame>
    ),
  },
  {
    id: 'final',
    seconds: 13,
    say: 'We think the reason is simple. An x402 payment is final in a second, and there is no chargeback. Seven cents can afford to be wrong. Seven hundred dollars cannot.',
    render: () => (
      <Frame>
        <Kicker>Why the payments stay small</Kicker>
        <Big size={104} max="15ch" color={white}>Paid in a second. <em>Final forever.</em></Big>
        <Body delay={0.7} size={40} max="27ch">Seven cents can afford to be wrong. Seven hundred dollars cannot.</Body>
        <Source>Our reading, not a measured cause. An x402 `exact` payment is a signed token transfer with no chargeback. Median facilitator settlement on devnet here: {((snapshot.measured.facilitatorSettleMsMedian ?? 0) / 1000).toFixed(1)} s ({snapshot.measured.viaFacilitator} payments).</Source>
      </Frame>
    ),
  },
  {
    id: 'cards',
    seconds: 14,
    say: 'Cards solve this with months of history. Visa wants purchases a hundred and twenty days old. On-chain, a review on the Solana registry costs a tenth of a cent and needs no purchase. Stars are nearly free to fake.',
    surface: 'paper',
    render: () => (
      <Frame>
        <Kicker color="#878371">How trust is built today</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 72, marginTop: 40 }}>
          <Rise delay={0.2}>
            <div className="display" style={{ fontSize: 190, lineHeight: 0.95 }}>120<span style={{ fontSize: 80 }}> days</span></div>
            <div style={{ fontSize: 30, marginTop: 22, lineHeight: 1.35, maxWidth: '20ch' }}>the youngest purchase history Visa accepts as evidence in a fraud dispute</div>
          </Rise>
          <Rise delay={0.6}>
            <div className="display" style={{ fontSize: 190, lineHeight: 0.95 }}>$0.001</div>
            <div style={{ fontSize: 30, marginTop: 22, lineHeight: 1.35, maxWidth: '20ch' }}>what one on-chain review costs. No purchase needed.</div>
          </Rise>
        </div>
        <Source dark={false}>Visa Compelling Evidence 3.0: two prior transactions, 120 to 365 days old (Checkout.com, 30 Oct 2025). Review price: solana.com/agent-registry.</Source>
      </Frame>
    ),
  },
  {
    id: 'tiers',
    seconds: 13,
    say: 'Tessera puts every x402 payment into escrow on Solana, and lets an on-chain credit score decide how long the money waits. On mainnet, a stranger waits three days. An agent with a record settles instantly.',
    render: () => <TierSlide />,
  },
  {
    id: 'how',
    seconds: 13,
    say: 'It needs no new standard. The 402 response names an escrow account as the address to pay. The buyer checks it on-chain, pays through a public x402 facilitator, and needs no SOL to pay.',
    render: () => (
      <Frame>
        <Kicker>No new standard</Kicker>
        <Big size={88} max="18ch" color={white}>One field changes: <em>where payTo points.</em></Big>
        <Rise delay={0.6} style={{ marginTop: 54 }}>
          <pre className="mono" style={{ fontSize: 27, lineHeight: 1.7, margin: 0, padding: '34px 40px', borderRadius: 22, background: '#10120e', border: '1px solid #272b21', color: '#c9c6b6' }}>
{`HTTP/1.1 402 Payment Required
{
  "scheme":  "exact",
  "network": "solana:EtWTRABZ…",     // devnet
  "amount":  "200000",
  "payTo":   `}<span style={{ color: mint }}>"JE6F5J7i…WdUW"</span>{`     `}<span style={{ color: '#5d5c52' }}>{'// an escrow account, not the merchant'}</span>{`
}`}
          </pre>
        </Rise>
        <div style={{ display: 'flex', gap: 44, marginTop: 44, fontSize: 25 }}>
          {['A2A to ask', 'x402 to pay', 'a facilitator settles', 'a Solana program holds'].map((t, k) => (
            <Rise key={t} delay={0.9 + k * 0.12}>
              <span style={{ color: white }}>{t}</span>
            </Rise>
          ))}
        </div>
        <Source>A real order from this project on devnet. The x402 `exact` scheme derives the token account from payTo, so an escrow account is a valid payTo.</Source>
      </Frame>
    ),
  },
  {
    id: 'score',
    seconds: 12,
    say: 'The score is how much we know, times whether it is good: settled volume, time and real counterparties, multiplied by ratings and behaviour. Every input is public.',
    surface: 'paper',
    render: () => (
      <Frame>
        <Kicker color="#878371">The score</Kicker>
        <Big size={92} max="17ch">How much is known, <em>times</em> whether it is good.</Big>
        <Rise delay={0.6} style={{ marginTop: 56 }}>
          <div className="display" style={{ fontSize: 66, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 22 }}>
            <span>score</span>
            <span style={{ color: '#878371' }}>=</span>
            <span style={{ padding: '6px 26px', borderRadius: 18, background: '#14130f', color: '#fbf8ef' }}>Evidence</span>
            <span style={{ color: '#878371' }}>×</span>
            <span style={{ padding: '6px 26px', borderRadius: 18, border: '2px solid #14130f' }}>Rating</span>
            <span style={{ color: '#878371' }}>×</span>
            <span style={{ padding: '6px 26px', borderRadius: 18, border: '2px solid #14130f' }}>Behaviour</span>
          </div>
        </Rise>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 54 }}>
          {[
            ['History', 'settled volume, weighted by who the counterparty was'],
            ['Tenure', 'time, counted only while actually trading'],
            ['Diversity', 'distinct counterparties, weighted by their tier'],
          ].map(([h, b], k) => (
            <Rise key={h} delay={0.9 + k * 0.12}>
              <div style={{ padding: 26, borderRadius: 20, border: '1px solid #ded7c2', background: '#fff' }}>
                <div className="display" style={{ fontSize: 44 }}>{h}</div>
                <div style={{ fontSize: 23, marginTop: 8, lineHeight: 1.35, color: '#4b483e' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Source dark={false}>Integer arithmetic over public accounts. The program, the SDK and the website run the same code and get the same number.</Source>
      </Frame>
    ),
  },
  {
    id: 'find',
    seconds: 9,
    say: 'One call tells an agent who to buy from: ranked by reviews that each cost a real sale, with price and seconds to settle.',
    render: () => <FindSlide />,
  },
  {
    id: 'rewards',
    seconds: 8,
    say: 'And reviews are paid: the same for one star or five, more if they prove right, nothing for praising a scam.',
    render: () => <RewardsSlide />,
  },
  {
    id: 'ring',
    seconds: 13,
    say: 'We assumed people would cheat. A small ring of your own wallets never reaches Trusted. A big one burns over a thousand dollars and a month, to steal back its fees plus twenty-five dollars a wallet.',
    render: () => <RingSlide />,
  },
  {
    id: 'zk',
    seconds: 8,
    say: 'Next, a zero-knowledge proof that each operator is one person. A ring becomes one identity. Nobody learns who.',
    render: () => <ZkSlide />,
  },
  {
    id: 'live',
    seconds: 11,
    say: 'This is live on devnet. Agents find each other, pay over x402, and earn their tier on-chain. Honest merchants reached Trusted; the wash-trading ring did not.',
    render: () => <LiveSlide />,
  },
  {
    id: 'cost',
    seconds: 9,
    say: 'It is also cheaper. Seven cents on a card costs thirty cents, disputable for four months. Here, a fraction of a cent.',
    render: () => <EfficiencySlide />,
  },
  {
    id: 'layers',
    seconds: 9,
    say: 'Solana has x402 for payment and a registry for identity. Tessera sits between them, and every review we send it carries proof of payment.',
    render: () => <LayerSlide />,
  },
  {
    id: 'market',
    seconds: 12,
    say: 'McKinsey estimates agents could orchestrate three to five trillion dollars of global commerce by twenty thirty. We take one percent of what settles. Sellers add one function; buyers, one check.',
    surface: 'paper',
    render: () => (
      <Frame pad={88}>
        <Kicker color="#878371">The market, and the business</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 64, marginTop: 30 }}>
          <Rise delay={0.2}>
            <div className="display" style={{ fontSize: 168, lineHeight: 0.95 }}>$3–5<span style={{ fontSize: 76 }}> trillion</span></div>
            <div style={{ fontSize: 27, marginTop: 18, lineHeight: 1.35, maxWidth: '25ch' }}>of global commerce that AI agents could orchestrate by 2030, on McKinsey's estimate</div>
          </Rise>
          <Rise delay={0.5}>
            <div className="display" style={{ fontSize: 168, lineHeight: 0.95 }}>1<span style={{ fontSize: 76 }}>%</span></div>
            <div style={{ fontSize: 27, marginTop: 18, lineHeight: 1.35, maxWidth: '22ch' }}>of what settles through escrow. Nothing on what does not.</div>
          </Rise>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginTop: 44 }}>
          {[
            ['For sellers', 'One function, quote(), opens the escrow behind an existing x402 endpoint or A2A agent.'],
            ['For buyers', 'One check, verifyOrderForPayment(), before signing. No SOL, no account, no sign-up.'],
            ['The score itself', 'Any wallet can be scored by anyone. A demo agent already sells credit reports for 30¢.'],
          ].map(([h, b], k) => (
            <Rise key={h} delay={0.8 + k * 0.12}>
              <div style={{ padding: '22px 26px', borderRadius: 20, border: '1px solid #ded7c2', background: '#fff', height: '100%' }}>
                <div className="display" style={{ fontSize: 36 }}>{h}</div>
                <div style={{ fontSize: 21, marginTop: 8, lineHeight: 1.4, color: '#4b483e' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={1.3} style={{ marginTop: 30 }}>
          <span className="mono" style={{ fontSize: 19, color: '#4b483e' }}>Illustration, not a forecast: 1% of the low estimate through escrow, at a 1% fee, is $300 million a year.</span>
        </Rise>
        <Source dark={false}>McKinsey, “The agentic commerce opportunity”: $3 trillion to $5 trillion globally by 2030. Tessera today: devnet only, no revenue, no outside users.</Source>
      </Frame>
    ),
  },
  {
    id: 'team',
    seconds: 13,
    say: "I'm Edison Liu. I study electronic and computer engineering at the ZJU-UIUC Institute, and I spend my spare time on Web3 and security research. I built Tessera for this hackathon, and I intend to keep building it.",
    render: () => (
      <Frame>
        <Kicker>Who is building it</Kicker>
        <Big size={120} color={white}>Edison Liu</Big>
        <Body delay={0.6} size={34} max="38ch">
          Electronic and Computer Engineering, ZJU-UIUC Institute. Builds working systems end to end, from embedded hardware to on-chain programs, with AI coding agents as the build engine.
        </Body>
        <div className="mono" style={{ display: 'flex', gap: 40, marginTop: 56, fontSize: 22, color: '#8b8a7c' }}>
          <Rise delay={0.9}><span>github.com/edison9733</span></Rise>
          <Rise delay={1.0}><span>edison9733.xyz</span></Rise>
        </div>
      </Frame>
    ),
  },
  {
    id: 'close',
    seconds: 7,
    say: 'Micropayments were the easy part. Every payment matters. This is Tessera.',
    render: () => (
      <Frame center>
        <Big size={70} max="20ch" color="#8b8a7c">Micropayments were the easy part.</Big>
        <Big size={150} delay={0.8} max="12ch" color={white}>Every payment <em style={{ color: mint }}>matters.</em></Big>
        <Rise delay={1.6} style={{ marginTop: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={40} invert />
          <span className="mono" style={{ fontSize: 22 }}>github.com/edison9733/agentic_commerce</span>
        </Rise>
      </Frame>
    ),
  },
];

export const PitchDeck = () => <Deck slides={PITCH} title="Tessera pitch" />;
