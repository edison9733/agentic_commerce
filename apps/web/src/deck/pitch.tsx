import { motion } from 'motion/react';
import { MAINNET_TARGET_PARAMS as P } from '@tessera/sdk';
import { Counter, EASE, Logo, TierBadge } from '../components/ui';
import { duration, TIER_DARK } from '../lib/format';
import * as payout from '../lib/rewardsDemo';
import snapshot from '../../../../deployments/snapshot.json';
import { Big, Body, Deck, Frame, Kicker, Rise, Source, type Slide } from './Deck';

const mint = '#b9f8da';
const white = '#f1eee2';

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
      <Kicker>Pain 3 · top up before every job, count the tokens · Fix 3: pay later</Kicker>
      <Big size={78} max="22ch" color={white}>
        Fund it roughly once. <em>Buy now, pay later.</em>
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
      <Kicker>Fix 2 · escrow that knows who it is dealing with</Kicker>
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
    seconds: 13,
    say: "AI agents now pay each other with x402, the payment protocol from Coinbase: about two hundred million payments so far, and on one recent day, the average was seven cents.",
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
    id: 'anon',
    seconds: 17,
    say: "But who is on the other end? One person can launch unlimited agents, with no identity check, and you can't tell who owns them. And an x402 payment is final: no chargeback. So Tessera is the bridge. We can't see who owns an agent, but we can see how it behaves: what it settled, how much, and how it was rated.",
    render: () => (
      <Frame>
        <Kicker>Pain 1 · who is on the other end?</Kicker>
        <Big size={92} max="24ch" color={white}>One person, unlimited agents. <em>No ID.</em></Big>
        <Body delay={0.7} size={34} max="40ch">And an x402 payment is final once it settles. No chargeback.</Body>
        <div style={{ display: 'flex', gap: 22, marginTop: 56 }}>
          {['Behaviour', 'Amounts settled', 'Ratings'].map((t, k) => (
            <Rise key={t} delay={1.2 + k * 0.15}>
              <span className="mono" style={{ fontSize: 26, padding: '14px 26px', borderRadius: 999, border: `1.5px solid ${mint}`, color: mint }}>{t}</span>
            </Rise>
          ))}
        </div>
        <Body delay={1.8} size={30} max="50ch"><span style={{ color: mint }}>Fix 1: a credit layer that labels each anonymous agent by how it behaves.</span></Body>
        <Source>Creating a Solana wallet needs no identity and costs nothing beyond fees. An x402 exact payment is a signed token transfer with no chargeback.</Source>
      </Frame>
    ),
  },
  {
    id: 'attacks',
    seconds: 21,
    say: "Then we hit three attacks. Sybil: one person posing as many agents. Friendly fraud: getting the goods, then claiming they never came. And reputation farming: trading with your own wallets until you look trusted, then taking strangers' money. So every payment goes into escrow, and waits until the wallet has earned trust. Faking a record now costs fees that never come back, and months you can't skip.",
    render: () => (
      <Frame>
        <Kicker>Pain 2 · three attacks we had to beat</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 26, marginTop: 10 }}>
          {[
            ['Sybil', 'One person, many wallets.'],
            ['Friendly fraud', 'Got the goods, claims they never came.'],
            ['Reputation farming', 'Trade with yourself until you look trusted, then cash in on strangers.'],
          ].map(([t, b], k) => (
            <Rise key={t} delay={0.3 + k * 0.2}>
              <div style={{ padding: '30px 30px 34px', borderRadius: 22, background: '#10120e', border: `1px solid ${k === 2 ? '#f2b8a8' : '#272b21'}`, height: '100%' }}>
                <div className="display" style={{ fontSize: 46, color: white, lineHeight: 1.05 }}>{t}</div>
                <div style={{ fontSize: 26, marginTop: 16, lineHeight: 1.4 }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Big size={70} delay={1.2} max="32ch" color={white}>Fix 2: escrow, <em>until the wallet has earned trust.</em></Big>
        <Body delay={1.6} size={30} max="52ch">Faking a record now costs fees that never come back, and months you can't skip.</Body>
        <Source>Mainnet targets: a new wallet counts 10%, each counterparty is capped, Trusted needs 30 active days; a farming ring costs hundreds to a few thousand dollars and one to three months. Priced, not impossible (docs/SECURITY.md).</Source>
      </Frame>
    ),
  },
  {
    id: 'tiers',
    seconds: 13,
    say: "And the escrow knows who it is dealing with. At our mainnet target, a fresh wallet's money waits three days. Two Trusted agents settle instantly.",
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
    id: 'rewards',
    seconds: 8,
    say: "Only a real buyer or seller can review, with the receipt on-chain. Reviewers get paid, and paid more when their warning proves right.",
    render: () => <RewardsSlide />,
  },
  {
    id: 'pay-later',
    seconds: 18,
    say: "Last pain: today you top up an agent's wallet before every job and count the tokens it needs. With Tessera, fund it roughly once. When a purchase is more than it holds, it buys now and pays later; the merchant is paid at once. The limit comes from the score: a new wallet gets nothing, paying on time raises it, and a default freezes it in public.",
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
