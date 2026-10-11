import { motion } from 'motion/react';
import { MAINNET_TARGET_PARAMS as P } from '@tessera/sdk';
import { Counter, EASE, Logo, TierBadge } from '../components/ui';
import { duration, TIER_DARK } from '../lib/format';
import { ranked, recordedAt, reproduce } from '../lib/findDemo';
import * as payout from '../lib/rewardsDemo';
import snapshot from '../../../../deployments/snapshot.json';
import { Big, Body, Deck, Frame, Kicker, Rise, Source, type Slide } from './Deck';

const mint = '#b9f8da';
const white = '#f1eee2';

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

function PayLaterSlide() {
  const rows: [string, string, string, string][] = [
    ['Fresh wallet', 'New · no settled trade yet', '0.00', '#8b8a7c'],
    ['Alice', 'Established 775 · bought 1.50, repaid on time', '3.88 → 4.84', mint],
    ['Bob', 'Established 775 · bought 2.00, never repaid', 'frozen 0.00', '#ec835a'],
  ];
  return (
    <Frame pad={84}>
      <Kicker>New · pay later for agents</Kicker>
      <Big size={78} max="22ch" color={white}>
        A good score earns speed. <em>Now it earns credit.</em>
      </Big>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 52, marginTop: 36, alignItems: 'start' }}>
        <Rise delay={0.4}>
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(([name, line, limit, color], k) => (
              <Rise key={name} delay={0.6 + k * 0.16}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 22px', borderRadius: 16, border: `1px solid ${k === 1 ? mint : '#272b21'}`, background: k === 1 ? '#121a14' : '#10120e' }}>
                  <div style={{ flex: 1 }}>
                    <span className="display" style={{ fontSize: 32, color: white }}>{name}</span>
                    <div className="mono" style={{ fontSize: 16, color: k === 0 ? '#8b8a7c' : color }}>{line}</div>
                  </div>
                  <span className="display" style={{ fontSize: 40, color }}>{limit}</span>
                </div>
              </Rise>
            ))}
          </div>
          <Rise delay={1.2}>
            <div className="mono" style={{ fontSize: 17, marginTop: 14, color: '#c9c6b6' }}>
              Limit in test USDC. The merchant got <span style={{ color: mint }}>1.47 of 1.50 at once</span>; the pool kept 2%.
            </div>
          </Rise>
        </Rise>
        <div style={{ display: 'grid', gap: 16 }}>
          {[
            ['Buy now', 'A pool pays the merchant at once. Only the buyer agent can spend its own credit.'],
            ['Pay later', 'The full price by the due date, no interest. On time raises the limit by 25%.'],
            ['Or default, in public', 'Anyone can mark a late loan. The line freezes at zero for good.'],
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
      <Source>Recorded 2026-10-11 on a local validator running the escrow program and the new pay-later program (preview, not on devnet). Tested by npm run test:paylater. Try it: npm run build:program && npm run paylater:local</Source>
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
      <Body delay={0.3} size={30} max="60ch">Every wallet has an on-chain score, built from settled orders, ratings and behaviour.</Body>
      <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
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
    seconds: 10,
    say: "GM everyone. I'm Edison Liu, a computer engineering student at the ZJU-UIUC Institute. I'm building Tessera, the credit layer for agentic commerce.",
    render: () => (
      <Frame center>
        <motion.div initial={{ scale: 0.6, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 1.2, ease: EASE }}>
          <Logo size={120} invert />
        </motion.div>
        <Big size={150} delay={0.4} color={white}>Tessera</Big>
        <Body delay={0.9} size={38} max="30ch">The credit layer for agentic commerce.</Body>
        <Rise delay={1.3} style={{ marginTop: 64 }}>
          <span className="mono" style={{ fontSize: 22, color: '#8b8a7c' }}>Edison Liu · Computer Engineering, ZJU-UIUC Institute</span>
        </Rise>
      </Frame>
    ),
  },
  {
    id: 'hook',
    seconds: 16,
    say: "AI agents can now pay each other with x402, the payment protocol from Coinbase. The Solana Foundation reports about two hundred million x402 payments so far, most under fifty cents. On one recent day, the average was seven cents.",
    render: () => (
      <Frame>
        <Kicker>x402, the payment protocol from Coinbase</Kicker>
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
    seconds: 18,
    say: "Here is the pain point. Payments stay small because an x402 payment is final once it settles. There is no chargeback. Seven cents can afford to be wrong. Seven hundred dollars cannot. So I focus on one question: how likely is this trade to succeed?",
    render: () => (
      <Frame>
        <Kicker>The pain point</Kicker>
        <Big size={104} max="15ch" color={white}>Final once it settles. <em>No chargeback.</em></Big>
        <Body delay={0.7} size={40} max="27ch">Seven cents can afford to be wrong. Seven hundred dollars cannot.</Body>
        <Body delay={1.4} size={34} max="50ch"><span style={{ color: mint }}>The question that matters: how likely is this trade to succeed?</span></Body>
        <Source>Our reading, not a measured cause. An x402 exact payment is a signed token transfer with no chargeback. Median facilitator settlement on devnet here: {((snapshot.measured.facilitatorSettleMsMedian ?? 0) / 1000).toFixed(1)} s ({snapshot.measured.viaFacilitator} payments).</Source>
      </Frame>
    ),
  },
  {
    id: 'tiers',
    seconds: 18,
    say: "Tessera puts the payment in escrow, and the escrow knows who it is dealing with. Every wallet has an on-chain score, built from settled orders, ratings and behaviour. At our mainnet target, a fresh wallet's money waits three days. Two Trusted agents settle instantly.",
    render: () => <TierSlide />,
  },
  {
    id: 'how',
    seconds: 8,
    say: "Nothing new to adopt. One field changes: payTo points to an escrow account instead of the merchant.",
    render: () => (
      <Frame>
        <Kicker>Nothing new to adopt</Kicker>
        <Big size={88} max="18ch" color={white}>One field changes: <em>where payTo points.</em></Big>
        <Rise delay={0.6} style={{ marginTop: 36 }}>
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
        <div style={{ display: 'flex', gap: 44, marginTop: 28, fontSize: 25 }}>
          {['A2A to ask', 'x402 to pay', 'a facilitator settles', 'a Solana program holds'].map((t, k) => (
            <Rise key={t} delay={0.9 + k * 0.12}>
              <span style={{ color: white }}>{t}</span>
            </Rise>
          ))}
        </div>
        <Source>A real order from this project on devnet. The x402 exact scheme derives the token account from payTo, so an escrow account is a valid payTo.</Source>
      </Frame>
    ),
  },
  {
    id: 'find',
    seconds: 7,
    say: "Agents can also search for sellers in one call. Each result says instant or escrow.",
    render: () => <FindSlide />,
  },
  {
    id: 'rewards',
    seconds: 6,
    say: "And reviewers get paid, and paid more when their warning proves right.",
    render: () => <RewardsSlide />,
  },
  {
    id: 'pay-later',
    seconds: 14,
    say: 'And a good score now earns credit. Agents can buy now and pay later. A pool pays the merchant at once, and the buyer repays by the due date. The limit comes from the Tessera score: a new wallet gets nothing, paying on time raises it, and a default freezes it in public.',
    render: () => <PayLaterSlide />,
  },
  {
    id: 'close',
    seconds: 22,
    say: "Why me? Every x402 payment already leaves a public record on the chain. My idea is to use that data to lower the risk of being scammed in agentic commerce. Without it, a payment is just a payment, and the data goes to waste. Micropayments were the easy part. Every payment matters. This is Tessera.",
    render: () => (
      <Frame center>
        <Big size={70} max="20ch" color="#8b8a7c">Micropayments were the easy part.</Big>
        <Big size={150} delay={0.8} max="12ch" color={white}>Every payment <em style={{ color: mint }}>matters.</em></Big>
        <Rise delay={1.6} style={{ marginTop: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={40} invert />
          <span className="mono" style={{ fontSize: 22 }}>agentic-commerce-two-theta.vercel.app</span>
        </Rise>
        <Rise delay={1.9} style={{ marginTop: 22 }}>
          <span className="mono" style={{ fontSize: 18, color: '#8b8a7c' }}>Live on Solana devnet · github.com/edison9733/agentic_commerce</span>
        </Rise>
      </Frame>
    ),
  },
];

export const PitchDeck = () => <Deck slides={PITCH} title="Tessera pitch" />;
