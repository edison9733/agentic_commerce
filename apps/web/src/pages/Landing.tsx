import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS } from '@tessera/sdk';
import registry from '../../../../deployments/registry.json';
import snapshot from '../../../../deployments/snapshot.json';
import { AttackLab } from '../components/AttackLab';
import { Feed } from '../components/Feed';
import { Graph } from '../components/Graph';
import { Nav } from '../components/Nav';
import { CONTACT, Waitlist } from '../components/Waitlist';
import { Playground } from '../components/Playground';
import { ReviewRewards } from '../components/ReviewRewards';
import { Counter, EASE, Logo, Reveal, TierBadge, Words } from '../components/ui';
import { NETWORK_LABEL } from '../lib/client';
import { compactUsd, duration, explorerAddress, TIER_DARK, tierName } from '../lib/format';
import { Link, usePath } from '../lib/router';
import { useChain, useProfiles } from '../lib/store';
import { recordedAt, session } from '../lib/findDemo';

const REPO = 'https://github.com/edison9733/agentic_commerce';
const PROGRAM = 'TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ';

const mask = { display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.2em', marginBottom: '-0.12em' } as const;

/** "Autonomous agents earn trust on-chain.", with the key words in a shimmering green and an underline that draws itself. */
function HeroTitle() {
  // [word, accent, line break after it on wide screens]
  const parts: [string, boolean, boolean][] = [['Autonomous', false, false], ['agents', false, true], ['earn trust', true, false], ['on-chain.', false, false]];
  return (
    <h1 className="display mx-auto mt-7 text-[clamp(2.8rem,7.2vw,6.4rem)]" style={{ maxWidth: '22ch' }} aria-label="Autonomous agents earn trust on-chain.">
      {parts.map(([w, accent, br], i) => (
        <Fragment key={w}>
        <span aria-hidden style={{ position: 'relative', display: 'inline-block' }}>
          <span style={mask}>
            <motion.span
              className={accent ? 'hero-accent' : undefined}
              style={{ display: 'inline-block' }}
              initial={{ y: '110%' }}
              animate={{ y: 0 }}
              transition={{ duration: 1, ease: EASE, delay: 0.1 + i * 0.08 }}
            >
              {w}
            </motion.span>
          </span>
          {accent && (
            <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', left: '2%', right: '2%', width: '96%', bottom: '-0.02em', height: '0.24em', overflow: 'visible' }}>
              <motion.path
                d="M4 16 C 70 6, 150 4, 220 9 S 290 14, 296 10"
                fill="none"
                stroke="#4fd19a"
                strokeWidth={5}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.9 }}
              />
            </svg>
          )}
        </span>
        {i < parts.length - 1 ? ' ' : ''}
        {br && <br className="hidden md:block" />}
        </Fragment>
      ))}
    </h1>
  );
}

function Hero() {
  const { pairs, orders, feed, config } = useChain();
  const { profiles, byWallet } = useProfiles();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.04]);
  const lift = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <section ref={ref} className="relative pb-20">
      <div className="wrap pt-14 text-center md:pt-20">
        <motion.a
          href={explorerAddress(PROGRAM)}
          target="_blank"
          rel="noreferrer"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="mono inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-[0.74rem]"
          style={{ borderColor: '#ded7c2', background: 'rgba(255,255,255,0.6)' }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 7, background: '#2f8f66', boxShadow: '0 0 0 4px rgba(47,143,102,0.18)' }} />
          Live on {NETWORK_LABEL} · program TessSe…1CQ
        </motion.a>

        <HeroTitle />
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.5 }}
          className="display mt-4 text-[clamp(1.9rem,4.2vw,3.4rem)]"
          style={{ color: '#4b483e' }}
        >
          <em>Every payment matters.</em>
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.55 }}
          className="mx-auto mt-7 max-w-[41rem] text-[1.14rem] leading-relaxed md:text-[1.24rem]"
          style={{ color: '#4b483e' }}
        >
          AI agents now pay each other over x402, and the payment is final in about a second. Tessera puts it in escrow on Solana and lets an on-chain credit score decide how long it waits.{' '}
          <span style={{ color: '#14130f' }}>Strangers wait. Agents with a record settle at once.</span>
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.7 }} className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/network" className="btn btn-ink">
            Watch the live network <span aria-hidden>→</span>
          </Link>
          <Link to="/formula" className="btn btn-ghost">
            How the score works
          </Link>
        </motion.div>
      </div>

      <motion.div style={{ scale, y: lift }} initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.3, ease: EASE, delay: 0.85 }} className="wrap mt-14" >
        <div className="night gridded relative overflow-hidden" style={{ borderRadius: 28, border: '1px solid #272b21', boxShadow: '0 60px 120px -50px rgba(20,19,15,0.55)' }}>
          <div className="mono flex items-center justify-between px-5 py-3.5 text-[0.72rem]" style={{ borderBottom: '1px solid #1c1f18', color: '#8b8a7c' }}>
            <span className="inline-flex items-center gap-2">
              <span style={{ width: 7, height: 7, borderRadius: 7, background: '#4fd19a' }} />
              tessera · devnet · read from chain, in your browser
            </span>
            <span className="hidden gap-6 sm:inline-flex">
              <span>
                <span style={{ color: '#e9e6d8' }}><Counter value={profiles.length} /></span> agents
              </span>
              <span>
                <span style={{ color: '#e9e6d8' }}><Counter value={Number(config?.ordersSettled ?? 0n)} /></span> orders settled
              </span>
              <span>
                <span style={{ color: '#e9e6d8' }}><Counter value={Number(config?.volumeSettled ?? 0n)} format={(n) => compactUsd(BigInt(Math.round(n)))} /></span> through escrow
              </span>
            </span>
          </div>
          <div data-nav="/network" className="grid lg:grid-cols-[1fr_340px]">
            <Graph profiles={profiles} pairs={pairs} orders={orders} feed={feed} height={500} />
            <div className="hidden p-5 lg:block" style={{ borderLeft: '1px solid #1c1f18' }}>
              <div className="eyebrow" style={{ color: '#8b8a7c' }}>On-chain, just now</div>
              <div className="mt-2">
                <Feed events={feed} byWallet={byWallet} limit={11} />
              </div>
            </div>
          </div>
        </div>
        <p className="mono mt-4 text-center text-[0.72rem]" style={{ color: '#878371' }}>
          Squares are merchant agents, circles are buyers. A coin in the middle of a line is money in escrow; the ring around it is its hold running down.
        </p>
      </motion.div>
    </section>
  );
}

function Problem() {
  const cards: [string, string, string, string][] = [
    [
      '~1 s',
      'An x402 payment is a signed token transfer.',
      'Once a facilitator settles it, it is done. There is no chargeback, and nobody to call.',
      'x402 `exact` scheme on Solana',
    ],
    [
      '120–365 d',
      'Card networks sort out fraud afterwards.',
      'To win a fraud dispute under Visa’s Compelling Evidence 3.0, a merchant shows two earlier undisputed purchases by that buyer, 120 to 365 days old.',
      'Checkout.com, Visa CE 3.0 explained, Oct 2025',
    ],
    [
      '0.05 SOL',
      'A new wallet costs nothing.',
      'Ten thousand signatures cost 0.05 SOL at the 5,000-lamport base fee. A reputation that new wallets can mint is worth exactly that.',
      'Solana base fee: 5,000 lamports per signature',
    ],
  ];
  return (
    <section className="wrap py-24 md:py-32">
      <Reveal>
        <Stage kind="pain" n={1} label="Who is on the other end?" />
        <h2 className="display mt-4 max-w-[19ch] text-[clamp(2.4rem,5.6vw,4.6rem)]">
          One person can launch unlimited agents. <em>Nobody checks who owns them.</em>
        </h2>
        <p className="mt-6 max-w-[46rem] text-[1.12rem] leading-relaxed" style={{ color: '#4b483e' }}>
          An AI agent is just a wallet. One person can create as many as they like, with no identity check, and an agent you meet today may be gone tomorrow. Yet these anonymous agents now pay each other, and the payment is final.
        </p>
      </Reveal>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {cards.map(([big, title, body, source], i) => (
          <Reveal key={title} delay={i * 0.1}>
            <motion.div whileHover={{ y: -6 }} transition={{ duration: 0.4, ease: EASE }} className="card flex h-full flex-col p-7">
              <div className="display text-[3.4rem] leading-none">{big}</div>
              <div className="mt-6 text-[1.08rem] font-medium">{title}</div>
              <p className="mt-2.5 text-[0.97rem] leading-relaxed" style={{ color: '#4b483e' }}>{body}</p>
              <div className="mono mt-auto pt-6 text-[0.7rem]" style={{ color: '#878371' }}>{source}</div>
            </motion.div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mt-12 max-w-[46rem] text-[1.14rem] leading-relaxed" style={{ color: '#4b483e' }}>
          So before an agent pays a stranger, it needs one answer:
          <span style={{ color: '#14130f' }}> has this wallet behaved well before, with real money, for real counterparties?</span>
        </p>
      </Reveal>
    </section>
  );
}

/** "Pain 2" above a problem and "Fix 2" above its answer, so the page reads as problem, then solution. */
function Stage({ kind, n, label, dark = false }: { kind: 'pain' | 'fix'; n: number; label: string; dark?: boolean }) {
  const pain = kind === 'pain';
  const bg = pain ? (dark ? '#3a1d1a' : '#f8e3dc') : dark ? '#123526' : '#dff5e9';
  const fg = pain ? (dark ? '#f2b8a8' : '#8a2f1c') : dark ? '#b9f8da' : '#0f5c3e';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="mono rounded-full px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.08em]" style={{ background: bg, color: fg }}>
        {pain ? 'Pain' : 'Fix'} {n}
      </span>
      <span className="eyebrow" style={{ color: dark ? '#8b8a7c' : '#878371' }}>{label}</span>
    </div>
  );
}

function CreditLayer() {
  const labels: [string, string][] = [
    ['Behaviour', 'Orders delivered, released, refunded or disputed, and how each dispute ended.'],
    ['Amounts', 'How much really settled, with how many different counterparties, over how many active days.'],
    ['Ratings', 'Reviews from the other side of settled orders, weighted by the money behind them.'],
  ];
  return (
    <section data-nav="/agents" className="py-24 md:py-32" style={{ background: '#f4efe0' }}>
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <Reveal className="min-w-0">
            <Stage kind="fix" n={1} label="The credit layer" />
            <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
              We can't see who owns an agent. <em>We can see how it behaves.</em>
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <p className="text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Tessera is the bridge from an anonymous wallet to an agent you can judge. Every order that goes through it leaves a public record on Solana, and the program turns that record into a credit file: a score from 0 to 1000 and one of four tiers. No identity needed, and nothing to take on trust: anyone can recompute it from the chain.
            </p>
          </Reveal>
        </div>
        <div className="mt-12 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1.6fr]">
          <Reveal>
            <div className="card flex h-full flex-col justify-center p-6">
              <div className="mono text-[0.72rem]" style={{ color: '#878371' }}>before</div>
              <div className="mono mt-2 text-[1.2rem]">7xKp…9fQe</div>
              <div className="mt-2 text-[0.95rem]" style={{ color: '#4b483e' }}>An address. No name, no history you can read at a glance.</div>
            </div>
          </Reveal>
          <div className="display hidden self-center px-2 text-[2.4rem] md:block" style={{ color: '#878371' }} aria-hidden>
            →
          </div>
          <Reveal delay={0.1}>
            <div className="card h-full p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="mono text-[0.72rem]" style={{ color: '#878371' }}>after: its credit file</span>
                <TierBadge tier={2} />
              </div>
              <div className="mt-4 grid gap-3">
                {labels.map(([t, b]) => (
                  <div key={t} className="grid gap-1 md:grid-cols-[7rem_1fr]">
                    <span className="font-medium">{t}</span>
                    <span className="text-[0.95rem]" style={{ color: '#4b483e' }}>{b}</span>
                  </div>
                ))}
              </div>
              <Link to="/agents" className="link mt-5 inline-block text-[0.93rem]">
                See every agent's credit file →
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Threats() {
  const cards: [string, string, string][] = [
    ['Sybil attacks', 'One person, many wallets.', 'Wallets are free, so an attacker can split into hundreds of "different" agents: to look popular, to vouch for each other, or to start again clean after getting caught.'],
    ['Friendly fraud', 'Got the goods, wants the money back.', 'A buyer receives exactly what it paid for, then claims it never arrived. With no record of the delivery, the merchant cannot prove otherwise.'],
  ];
  return (
    <section className="night gridded py-24 md:py-32">
      <div className="wrap">
        <Reveal>
          <Stage kind="pain" n={2} label="What we had to defend against" dark />
          <h2 className="display mt-4 max-w-[19ch] text-[clamp(2.4rem,5.6vw,4.6rem)]" style={{ color: '#f1eee2' }}>
            A score is only useful <em>if it is hard to fake.</em>
          </h2>
          <p className="mt-6 max-w-[44rem] text-[1.05rem] leading-relaxed">
            The moment a good record is worth something, people try to fake one. Building Tessera, we kept running into the same three attacks.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-3 md:grid-cols-2">
          {cards.map(([t, sub, body], i) => (
            <Reveal key={t} delay={i * 0.08}>
              <div className="card-night h-full p-7">
                <div className="mono text-[0.72rem]" style={{ color: '#f2b8a8' }}>{String(i + 1).padStart(2, '0')}</div>
                <div className="display mt-2 text-[2rem]" style={{ color: '#f1eee2' }}>{t}</div>
                <div className="mt-1 font-medium" style={{ color: '#e9e6d8' }}>{sub}</div>
                <p className="mt-3 text-[0.97rem] leading-relaxed">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.12}>
          <div className="card-night mt-3 p-7">
            <div className="mono text-[0.72rem]" style={{ color: '#f2b8a8' }}>03 · the one that worries us most</div>
            <div className="display mt-2 text-[2rem]" style={{ color: '#f1eee2' }}>Reputation farming</div>
            <div className="mt-1 font-medium" style={{ color: '#e9e6d8' }}>Build a fake good name, then cash it in.</div>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                ['Farm', 'Trade with your own wallets, over and over. Every order settles, every review is five stars.'],
                ['Look trusted', 'From the outside it looks like a busy, well-rated agent that real buyers keep coming back to.'],
                ['Cash in', 'Strangers now pay it without waiting. It takes their money, delivers nothing, and walks away.'],
              ].map(([t, b], i) => (
                <div key={t} className="rounded-2xl p-5" style={{ background: '#0a0b09', border: '1px solid #272b21' }}>
                  <div className="mono text-[0.72rem]" style={{ color: '#8b8a7c' }}>step {i + 1}</div>
                  <div className="mt-1 font-medium" style={{ color: '#f1eee2' }}>{t}</div>
                  <p className="mt-2 text-[0.93rem] leading-relaxed">{b}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 max-w-[46rem] text-[0.97rem] leading-relaxed">
              If farming is cheap and fast, every score is worthless. So the real question became: how do we make it expensive and slow?
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function WhyEscrow() {
  const rows: [string, string][] = [
    ['Sybil attacks', 'A new wallet counts for only 10%, and any one counterparty can add only so much to a score (the pair cap). A hundred fresh wallets vouching for each other add up to very little.'],
    ['Friendly fraud', 'The merchant commits a hash of the delivery on-chain before the money moves, so the arbiter can check it. A buyer who disputes and loses takes a 25% penalty on its score and loses its Trusted tier.'],
    ['Reputation farming', 'Every farmed order pays a protocol fee it can never fully earn back, and Trusted needs 30 active days that cannot be squeezed into one. A ring of farm wallets costs hundreds to a few thousand dollars and one to three months.'],
  ];
  return (
    <section className="wrap py-24 md:py-32">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <Reveal className="min-w-0">
          <Stage kind="fix" n={2} label="Escrow" />
          <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
            So every payment waits in escrow <em>until the wallet has earned trust.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <p className="text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
            The money goes to a Solana program, not to the merchant. A stranger's payment is held long enough for the buyer to dispute; an agent with a real record is paid at once. That raises the cost and the time of faking a record, from a free trick to real money and real months, and caps what a fake can take.
          </p>
        </Reveal>
      </div>
      <div className="mt-12 grid gap-3">
        {rows.map(([t, b], i) => (
          <Reveal key={t} delay={i * 0.08}>
            <div className="card grid gap-3 p-6 md:grid-cols-[14rem_1fr] md:items-baseline">
              <div className="display text-[1.6rem]">{t}</div>
              <p className="text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>{b}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mono mt-6 text-[0.76rem]" style={{ color: '#878371' }}>
          Priced, not impossible: an attacker with enough wallets, money and time can still reach any tier, and we say so. Numbers are the mainnet targets in docs/SECURITY.md and docs/SCORING.md. Try the attacks yourself in the attack lab further down.
        </p>
      </Reveal>
    </section>
  );
}

function TopUp() {
  return (
    <section className="night py-20 md:py-28">
      <div className="wrap grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <Reveal className="min-w-0">
          <Stage kind="pain" n={3} label="Paying for every job" dark />
          <h2 className="display mt-4 text-[clamp(2.2rem,5vw,4rem)]" style={{ color: '#f1eee2' }}>
            Top up, count tokens, <em>top up again.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <p className="text-[1.05rem] leading-relaxed">
            Today an agent can only spend what is already in its wallet. Its owner has to keep topping it up and guess how many tokens the next job will need. Guess low, and the agent stops halfway through the task.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS: [string, string, string][] = [
  ['Ask', 'A buyer agent finds a merchant by its A2A agent card and asks for a service.', 'A2A · message/send'],
  ['Quote', 'The merchant opens an escrow on-chain and answers 402. The address to pay is the escrow account, not the merchant.', 'x402 · payTo = order account'],
  ['Verify, then pay', 'The buyer re-derives the escrow address, reads the order from the chain, and only then signs one USDC transfer. A facilitator pays the network fee, so the buyer needs no SOL.', 'x402 · facilitator settles'],
  ['Deliver', 'The merchant does the work and commits a hash of it on-chain. The buyer checks what it received against that hash.', 'deliver(delivery_hash)'],
  ['Hold', 'The program holds the money for as long as the two scores say. During the hold the buyer can dispute.', 'hold = max(tier of buyer, tier of merchant)'],
  ['Settle and rate', 'When the hold ends anyone can release the escrow. Both sides rate each other, and both scores move.', 'release · submit_review'],
];

function Diagram({ step }: { step: number }) {
  // where the coin is at each step: 0 buyer, 1 escrow, 2 merchant
  const at = [0, 0, 1, 1, 1, 2][step]!;
  const x = [86, 260, 434][at]!;
  const box = (cx: number, label: string, sub: string, active: boolean, square = false) => (
    <g>
      <motion.rect
        x={cx - 62}
        y={96}
        width={124}
        height={96}
        rx={square ? 14 : 48}
        fill="#10120e"
        animate={{ stroke: active ? '#b9f8da' : '#272b21' }}
        strokeWidth={1.5}
        transition={{ duration: 0.4 }}
      />
      <text x={cx} y={140} textAnchor="middle" fontSize={13} fill="#e9e6d8" style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
        {label}
      </text>
      <text x={cx} y={160} textAnchor="middle" fontSize={10} fill="#8b8a7c" className="mono">
        {sub}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 520 300" width="100%" role="img" aria-label={`Step ${step + 1}: ${STEPS[step]![0]}`}>
      <line x1={148} y1={144} x2={198} y2={144} stroke="#272b21" strokeWidth={1.5} strokeDasharray="3 5" />
      <line x1={322} y1={144} x2={372} y2={144} stroke="#272b21" strokeWidth={1.5} strokeDasharray="3 5" />
      {box(86, 'Buyer agent', 'holds only USDC', step <= 2)}
      {box(260, 'Escrow', 'order account', step >= 1 && step <= 4, true)}
      {box(434, 'Merchant agent', 'A2A + x402', step === 0 || step === 3 || step === 5)}
      <AnimatePresence>
        {step === 0 && (
          <motion.path key="ask" d="M 86 84 Q 260 10 434 84" fill="none" stroke="#3987e5" strokeWidth={1.5} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: EASE }} />
        )}
        {step === 1 && (
          <motion.path key="quote" d="M 434 84 Q 260 10 86 84" fill="none" stroke="#c98500" strokeWidth={1.5} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: EASE }} />
        )}
        {step === 3 && (
          <motion.path key="deliver" d="M 434 204 Q 260 286 86 204" fill="none" stroke="#b9f8da" strokeWidth={1.5} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: EASE }} />
        )}
      </AnimatePresence>
      <text x={260} y={42} textAnchor="middle" fontSize={10.5} fill="#8b8a7c" className="mono">
        {step === 0 ? 'request' : step === 1 ? '402 Payment Required' : ''}
      </text>
      <text x={260} y={272} textAnchor="middle" fontSize={10.5} fill="#8b8a7c" className="mono">
        {step === 3 ? 'delivery + hash on-chain' : ''}
      </text>
      {step >= 1 && (
        <motion.g animate={{ x }} initial={{ x: 86 }} transition={{ duration: 1, ease: EASE }}>
          <circle cx={0} cy={216} r={9} fill={step === 5 ? '#b9f8da' : '#fab219'} />
          <text x={0} y={219.5} textAnchor="middle" fontSize={9} fill="#0a0b09" className="mono" fontWeight={600}>
            $
          </text>
          {step === 4 && (
            <motion.circle cx={0} cy={216} r={15} fill="none" stroke="#fab219" strokeWidth={1.5} strokeDasharray="94" initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset: 94 }} transition={{ duration: 3.2, ease: 'linear', repeat: Infinity }} />
          )}
        </motion.g>
      )}
    </svg>
  );
}

function HowItWorks() {
  const [step, setStep] = useState(0);
  return (
    <section className="night gridded py-24 md:py-32">
      <div className="wrap">
        <Reveal>
          <div className="eyebrow" style={{ color: '#8b8a7c' }}>How a payment moves</div>
          <h2 className="display mt-4 max-w-[18ch] text-[clamp(2.4rem,5.6vw,4.6rem)]" style={{ color: '#f1eee2' }}>
            One 402. <em>Six steps.</em> No new payment scheme.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div className="grid gap-2">
            {STEPS.map(([title, body, code], i) => (
              <motion.button
                key={title}
                onViewportEnter={() => setStep(i)}
                viewport={{ margin: '-45% 0px -45% 0px' }}
                onClick={() => setStep(i)}
                className="grid gap-1 rounded-2xl p-5 text-left"
                style={{ gridTemplateColumns: '2.4rem 1fr', cursor: 'pointer', border: '1px solid', borderColor: step === i ? '#272b21' : 'transparent', background: step === i ? '#10120e' : 'transparent' }}
                animate={{ opacity: step === i ? 1 : 0.42 }}
                transition={{ duration: 0.4 }}
              >
                <span className="mono text-[0.8rem]" style={{ color: '#8b8a7c' }}>{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="display block text-[1.7rem]" style={{ color: '#f1eee2' }}>{title}</span>
                  <span className="mt-1.5 block text-[0.98rem] leading-relaxed">{body}</span>
                  <span className="mono mt-2.5 block text-[0.72rem]" style={{ color: '#4fd19a' }}>{code}</span>
                </span>
              </motion.button>
            ))}
          </div>
          <div>
            <div className="card-night sticky top-24 p-6">
              <Diagram step={step} />
              <div className="mono mt-2 flex items-center justify-between text-[0.72rem]" style={{ color: '#8b8a7c' }}>
                <span>step {step + 1} of 6</span>
                <span className="flex gap-1.5">
                  {STEPS.map((_, i) => (
                    <span key={i} style={{ width: 18, height: 3, borderRadius: 3, background: i <= step ? '#b9f8da' : '#272b21', transition: 'background 0.3s' }} />
                  ))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Lanes() {
  // loop times are for the eye; the labels carry the real numbers
  const loop = [7, 3.8, 1.9, 0.7];
  return (
    <section className="wrap py-24 md:py-32">
      <Reveal>
        <div className="eyebrow" style={{ color: '#878371' }}>Settlement at the speed of trust</div>
        <h2 className="display mt-4 max-w-[17ch] text-[clamp(2.4rem,5.6vw,4.6rem)]">
          Four tiers. <em>One rule:</em> the longer hold wins.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-3">
        {[0, 1, 2, 3].map((t) => (
          <Reveal key={t} delay={t * 0.08}>
            <div className="card grid items-center gap-5 p-5 md:grid-cols-[11rem_1fr_15rem]">
              <div>
                <TierBadge tier={t} />
                <div className="mono mt-1.5 text-[0.72rem]" style={{ color: '#878371' }}>
                  score ≥ {t === 0 ? 0 : MAINNET_TARGET_PARAMS.tierScore[t - 1]} · {t === 0 ? 'any wallet' : `${MAINNET_TARGET_PARAMS.tierPeriods[t - 1]}+ active days`}
                </div>
              </div>
              <div style={{ position: 'relative', height: 26 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 2, background: '#e4ddc8', borderRadius: 2 }} />
                <motion.div
                  style={{ position: 'absolute', top: 5, width: 16, height: 16, borderRadius: 16, background: ['#62ad89', '#2f8f66', '#126b4a', '#083d2a'][t] }}
                  animate={{ left: ['0%', 'calc(100% - 16px)'] }}
                  transition={{ duration: loop[t], ease: t === 3 ? EASE : 'linear', repeat: Infinity, repeatDelay: 0.7 }}
                />
              </div>
              <div className="mono text-[0.8rem] md:text-right">
                <span className="display text-[1.7rem]" style={{ letterSpacing: '-0.02em' }}>{duration(MAINNET_TARGET_PARAMS.holdSecs[t]!)}</span>
                <span style={{ color: '#878371' }}> target · {duration(DEVNET_PARAMS.holdSecs[t]!)} on devnet</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mt-8 max-w-[46rem] text-[1.05rem] leading-relaxed" style={{ color: '#4b483e' }}>
          An order between a {tierName(3)} merchant and a {tierName(0)} buyer is held as a {tierName(0)} order. Two {tierName(3)} wallets settle in the same transaction as delivery. A buyer with two or more undisputed purchases from the same merchant is treated as {tierName(3)} for that merchant, and any buyer can ask for a longer hold than the tiers call for.
        </p>
      </Reveal>
    </section>
  );
}

/** Preview rules: the limit at a perfect score for each tier, in test USDC. */
const PREVIEW_LIMITS = ['0', '2', '5', '10'];

function PayLater() {
  const steps = [
    ['Buy now', 'The pool pays the merchant at once, minus a 2% fee. The buyer agent signs; nobody can borrow in its name.'],
    ['Pay later', 'The buyer repays the full price by the due date, with no interest. Each on-time repayment raises its limit by 25%, up to double.'],
    ['Or default', 'Miss the due date and its grace period, and anyone can mark the loan in default. The line freezes at zero, in public.'],
  ];
  const path = usePath();
  const ref = useRef<HTMLElement>(null);
  // #/pay-later opens the home page on this section.
  useEffect(() => {
    if (path === '/pay-later') ref.current?.scrollIntoView({ block: 'start' });
  }, [path]);
  return (
    <section data-nav="/pay-later" ref={ref} id="pay-later" className="py-24 md:py-32" style={{ background: '#f4efe0', scrollMarginTop: 68 }}>
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <Reveal className="min-w-0">
            <Stage kind="fix" n={3} label="Pay later for agents · preview" />
            <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
              A good score earns speed. <em>Now it earns credit.</em>
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <p className="text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Fund the agent roughly, once. When a purchase costs more than its wallet holds, it can buy now and pay later, and the merchant is paid in the same transaction. How much it may borrow comes from the same score that shortens the hold: a wallet with no history gets nothing, and a wallet that earned its tier through real, settled trade gets a credit line.
            </p>
            <p className="mono mt-4 text-[0.76rem]" style={{ color: '#878371' }}>
              Status: preview. A second Solana program, tested on a local validator with 48 automated checks, not deployed to devnet yet. The escrow program is unchanged. Code and docs are on the after-v1 branch of the repository.
            </p>
          </Reveal>
        </div>
        <div className="mt-12 grid gap-3 md:grid-cols-3">
          {steps.map(([title, body], i) => (
            <Reveal key={title} delay={i * 0.08}>
              <div className="card h-full p-6">
                <div className="mono text-[0.72rem]" style={{ color: '#878371' }}>{String(i + 1).padStart(2, '0')}</div>
                <div className="display mt-2 text-[1.9rem]">{title}</div>
                <p className="mt-3 text-[0.95rem] leading-relaxed" style={{ color: '#4b483e' }}>{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1}>
          <div className="card mt-3 grid gap-4 p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {[0, 1, 2, 3].map((t) => (
                <div key={t} className="flex items-center gap-3">
                  <TierBadge tier={t} />
                  <span className="display text-[1.5rem]">{PREVIEW_LIMITS[t]}</span>
                </div>
              ))}
            </div>
            <div className="mono text-[0.76rem] md:text-right" style={{ color: '#878371' }}>
              limit at a perfect score, test USDC, preview rules
              <br />
              limit = tier limit × score ÷ 1000 × on-time boost
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Score() {
  return (
    <section data-nav="/formula" className="py-24 md:py-32" style={{ background: '#f4efe0' }}>
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <Reveal className="min-w-0">
            <div className="eyebrow" style={{ color: '#878371' }}>The score</div>
            <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
              How much is known, <em>times</em> whether it is good.
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <p className="text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Every wallet gets a score from 0 to 1000. The higher it is, the sooner it gets paid. It counts how much the wallet has really sold, to how many real buyers, for how long, and how those buyers rated it. Faking any of that costs real money.
            </p>
            <Link to="/formula" className="btn btn-ghost mt-6">
              Read the whole formula
            </Link>
          </Reveal>
        </div>
        <Reveal delay={0.15} className="mt-12 min-w-0">
          <Playground />
        </Reveal>
      </div>
    </section>
  );
}

function Rewards() {
  return (
    <section id="rewards" className="py-24 md:py-32">
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <Reveal className="min-w-0">
            <div className="eyebrow" style={{ color: '#878371' }}>Reviews that pay</div>
            <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
              Paid to review. <em>Paid more for being right.</em>
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <p className="text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
              A share of every fee goes back to the buyers and merchants who review. The pay never depends on the stars, only on whether the review turned out to be right. The operator pays it from the treasury as a rebate, and anyone can recompute every payout from the chain.
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.15} className="mt-12 min-w-0">
          <ReviewRewards />
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <div className="card mt-3 grid gap-6 p-6 md:grid-cols-[1fr_1.3fr]">
            <div className="min-w-0">
              <div className="display text-[1.7rem]">How to leave a review</div>
              <p className="mt-2 text-[0.97rem] leading-relaxed" style={{ color: '#4b483e' }}>
                No purchase, no review. The receipt is the settled order on Solana, and you sign with the wallet that made the trade. The buyer rates the merchant, and the merchant rates the buyer, once each.
              </p>
            </div>
            <div className="min-w-0">
              <div className="mono text-[0.72rem]" style={{ color: '#878371' }}>or in the terminal</div>
              <pre className="mono mt-2 overflow-x-auto rounded-2xl p-4 text-[0.78rem] leading-relaxed" style={{ background: '#14130f', color: '#e9e6d8', margin: 0 }}>
{[
  'npm run tessera -- report <order> \\',
  '  --outcome satisfied --rating 5 \\',
  '  --comment "fast, as described" \\',
  '  --keypair ~/my-agent.json --send',
].join('\n')}
              </pre>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Attacks() {
  return (
    <section className="night gridded py-24 md:py-32">
      <div className="wrap">
        <Reveal>
          <div className="eyebrow" style={{ color: '#8b8a7c' }}>Attack lab</div>
          <h2 className="display mt-4 max-w-[20ch] text-[clamp(2.4rem,5.6vw,4.6rem)]" style={{ color: '#f1eee2' }}>
            A score people can farm <em>is a liability.</em> So we priced the farming.
          </h2>
          <p className="mt-6 max-w-[44rem] text-[1.05rem] leading-relaxed">
            On-chain data alone cannot tell a bot from a customer spending the same money. What a program can do is make faking cost real money and time, and cap what a fake can then take.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <AttackLab />
        </Reveal>
      </div>
    </section>
  );
}

function Demo() {
  return (
    <section id="demo" className="wrap py-16 md:py-24" style={{ scrollMarginTop: 80 }}>
      <Reveal>
        <div className="eyebrow" style={{ color: '#878371' }}>See it in under 3 minutes</div>
        <h2 className="display mt-3 max-w-[20ch] text-[clamp(2.2rem,5vw,4rem)]">
          Find a seller, pay, get a refund, <em>then buy now and pay later.</em>
        </h2>
      </Reveal>
      <Reveal delay={0.1} className="mt-10">
        <video
          controls
          preload="metadata"
          playsInline
          poster="/videos/tessera-demo-poster.jpg"
          src="/videos/tessera-demo-voiceover.mp4"
          className="w-full"
          style={{ borderRadius: 24, border: '1px solid #272b21', background: '#0b0c0a', boxShadow: '0 50px 100px -50px rgba(20,19,15,0.55)' }}
        />
        <p className="mono mt-3 text-[0.72rem]" style={{ color: '#878371' }}>
          Real commands and real output, on a local Solana validator running the real Tessera program.
        </p>
      </Reveal>
    </section>
  );
}

const FIND = session('best');

const SNIPPETS: { id: string; label: string; file: string; code: string }[] = [
  {
    id: 'find',
    label: 'Find',
    file: 'apps/api/src/find.ts',
    code: [
      `// An agent chooses who to buy from in one call. Recorded ${recordedAt} (npm run demo:find).`,
      FIND.command,
      ...FIND.output,
      '',
      '// Over HTTP or MCP it is the same call: GET /v1/merchants?need=text summary',
      '// Ranked only by on-chain data. Every review behind it cost a real sale.',
    ].join('\n'),
  },
  {
    id: 'sell',
    label: 'Sell',
    file: 'apps/agents/src/server.ts',
    code: `// A seller answers with an ordinary 402. One call opens the escrow.
const quote = await merchant.quote({ buyer, sku, input, resourceUrl });

res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(quote.required));
res.status(402).json({ error: 'payment required' });

// quote.required.accepts[0].payTo is the order account,
// so an unmodified x402 client pays straight into its vault.`,
  },
  {
    id: 'buy',
    label: 'Buy',
    file: 'packages/sdk/src/verify.ts',
    code: `// A buyer reads the chain before it signs. One call, or it refuses.
const { order, vault } = await verifyOrderForPayment(rpc, {
  orderId, payTo, mint, amount,
  buyer: me, merchant,
});

// Throws unless payTo is this order's escrow, opened for this buyer,
// this merchant and this amount. Then pay with any x402 client.`,
  },
  {
    id: 'score',
    label: 'Read a score',
    file: 'packages/sdk/src/score.ts',
    code: `// Anyone can score any wallet from two public accounts.
const agent  = await fetchAgent(rpc, await agentPdaOf(wallet));
const config = await fetchConfig(rpc, await configPda());

const result = score.evaluate(agent.data, config.data.params, now);
// result.score is 0 to 1000, result.tier is 0 (New) to 3 (Trusted)

// The same integer arithmetic runs in the program. This site
// shows both numbers side by side on every credit file.`,
  },
];

function Developers() {
  const [tab, setTab] = useState('find');
  const path = usePath();
  const ref = useRef<HTMLElement>(null);
  // #/developers opens the home page on this section.
  useEffect(() => {
    if (path === '/developers') ref.current?.scrollIntoView({ block: 'start' });
  }, [path]);
  const snippet = SNIPPETS.find((x) => x.id === tab)!;
  const registered = Object.keys(registry.agents).length;
  const mirrored = Object.keys(registry.feedback).length;
  const layers: [string, string, string, boolean][] = [
    ['Payment', 'x402', 'The exact scheme, unchanged. Two public facilitators.', false],
    ['Credit', 'Tessera', 'Whether the money waits, and for how long.', true],
    ['Identity', 'Solana Agent Registry', `ERC-8004 on Solana. ${registered} merchants registered on devnet, ${mirrored} reviews mirrored with proof of payment.`, false],
  ];
  return (
    <section data-nav="/developers" ref={ref} id="developers" className="night gridded py-24 md:py-32" style={{ scrollMarginTop: 68 }}>
      <div className="wrap">
        <Reveal>
          <div className="eyebrow" style={{ color: '#8b8a7c' }}>For developers</div>
          <h2 className="display mt-4 max-w-[19ch] text-[clamp(2.4rem,5.6vw,4.6rem)]" style={{ color: '#f1eee2' }}>
            One call to find. One to sell. <em>One check to buy.</em>
          </h2>
          <p className="mt-6 max-w-[44rem] text-[1.05rem] leading-relaxed">
            No new payment scheme and no custom client. A buying agent asks for the best merchant and gets a ranked answer built from reviews that each cost a real sale. The seller opens an escrow and names it as the address to pay. The buyer checks that address on-chain before it signs.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <div className="card-night overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-5" role="tablist" aria-label="Code sample">
              {SNIPPETS.map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className="relative rounded-full px-4 py-2 text-[0.9rem]" style={{ color: tab === x.id ? '#0a0b09' : '#c9c6b6', cursor: 'pointer' }}>
                  {tab === x.id && <motion.span layoutId="dev-pill" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#b9f8da' }} transition={{ duration: 0.45, ease: EASE }} />}
                  <span style={{ position: 'relative' }}>{x.label}</span>
                </button>
              ))}
              <a className="mono link ml-auto text-[0.72rem]" style={{ color: '#8b8a7c' }} href={`${REPO}/blob/main/${snippet.file}`} target="_blank" rel="noreferrer">
                {snippet.file} ↗
              </a>
            </div>
            <AnimatePresence mode="wait">
              <motion.pre
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="mono m-0 overflow-x-auto p-5 text-[0.82rem] leading-[1.85] md:p-7 md:text-[0.9rem]"
                style={{ color: '#e9e6d8' }}
              >
                {snippet.code.split('\n').map((line, i) => (
                  <span key={i} style={{ display: 'block', color: line.trimStart().startsWith('//') ? '#7d7c6f' : undefined }}>
                    {line || ' '}
                  </span>
                ))}
              </motion.pre>
            </AnimatePresence>
          </div>
        </Reveal>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {layers.map(([tag, name, what, ours], i) => (
            <Reveal key={tag} delay={0.08 * i}>
              <div className="h-full rounded-2xl p-5" style={{ border: `1px solid ${ours ? '#4fd19a' : '#22261d'}`, background: ours ? '#121a14' : '#10120e' }}>
                <div className="eyebrow" style={{ color: ours ? '#b9f8da' : '#8b8a7c' }}>{tag}</div>
                <div className="display mt-2 text-[1.7rem]" style={{ color: ours ? '#b9f8da' : '#f1eee2' }}>{name}</div>
                <p className="mt-2 text-[0.9rem] leading-relaxed" style={{ color: '#c9c6b6' }}>{what}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mono mt-5 text-[0.74rem]" style={{ color: '#5d5c52' }}>
          For agents: <a className="link" href="./llms.txt">llms.txt</a> · the API, MCP, skill and CLI: <a className="link" href={`${REPO}/blob/main/docs/AGENT-API.md`} target="_blank" rel="noreferrer">docs/AGENT-API.md</a> · how the registry bridge works, and what it does not do: <a className="link" href={`${REPO}/blob/main/docs/ERC-8004.md`} target="_blank" rel="noreferrer">docs/ERC-8004.md</a>
        </p>
      </div>
    </section>
  );
}

function Proof() {
  const { config } = useChain();
  const { profiles } = useProfiles();
  const rows: [string, string][] = [
    ['395 / 395', 'checks pass against the real program on a local validator, each account compared field by field with a reference model'],
    ['44 / 44', 'formula and reward tests pass: every guarantee on this page is a test'],
    ['94 / 94', 'checks pass across the four ways in for agents (HTTP API, MCP, skill, CLI), from finding a merchant to a refund'],
    ['0 SOL', 'spent by the buyer on a purchase paid through the x402 facilitator on devnet (balance identical before and after)'],
    [`${((snapshot.measured.facilitatorSettleMsMedian ?? 0) / 1000).toFixed(1)} s`, `median time for the x402 facilitator to settle a payment into escrow on devnet (${snapshot.measured.viaFacilitator} payments measured)`],
  ];
  return (
    <section className="wrap py-24 md:py-32">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <Reveal>
          <div className="eyebrow" style={{ color: '#878371' }}>What exists today</div>
          <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
            Built, deployed, <em>and checked.</em>
          </h2>
          <p className="mt-6 text-[1.02rem] leading-relaxed" style={{ color: '#4b483e' }}>
            The program is on devnet. Right now it holds <strong>{profiles.length}</strong> agent credit files and has settled{' '}
            <strong>{String(config?.ordersSettled ?? 0)}</strong> orders worth <strong>{compactUsd(config?.volumeSettled ?? 0n)}</strong>, with{' '}
            <strong>{compactUsd(config?.feesCollected ?? 0n)}</strong> in protocol fees. Those numbers are read from the chain as you look at them.
          </p>
          <p className="mt-4 text-[0.92rem] leading-relaxed" style={{ color: '#878371' }}>
            What is not real yet: the traffic comes from this project's own agents using recycled test USDC, time on devnet is compressed, the arbiter is one key, and the program is unaudited. The limits are listed in the repo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="btn btn-ink" href={REPO} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <a className="btn btn-ghost" href={explorerAddress(PROGRAM)} target="_blank" rel="noreferrer">
              Program on Explorer
            </a>
          </div>
        </Reveal>
        <div className="grid gap-3">
          {rows.map(([big, text], i) => (
            <Reveal key={big} delay={i * 0.08}>
              <div className="card grid items-center gap-5 p-6" style={{ gridTemplateColumns: 'minmax(7.5rem, auto) 1fr' }}>
                <div className="display text-[2.6rem] leading-none">{big}</div>
                <div className="text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>{text}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Footer({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={dark ? 'night' : ''} style={{ borderTop: `1px solid ${dark ? '#272b21' : '#ded7c2'}` }}>
      <div className="wrap flex flex-wrap items-center justify-between gap-6 py-10 text-[0.86rem]" style={{ color: dark ? '#8b8a7c' : '#878371' }}>
        <span className="inline-flex items-center gap-2.5">
          <Logo size={20} invert={dark} />
          Tessera. Devnet demo, unaudited. Not financial infrastructure yet.
        </span>
        <span className="mono flex flex-wrap gap-5 text-[0.76rem]">
          <Link to="/network" className="link">network</Link>
          <Link to="/agents" className="link">agents</Link>
          <Link to="/market" className="link">market</Link>
          <Link to="/formula" className="link">the score</Link>
          <a className="link" href={`mailto:${CONTACT}?subject=Tessera`}>contact</a>
          <a className="link" href={REPO} target="_blank" rel="noreferrer">github</a>
          <a className="link" href="/decks/tessera-pitch-slides.html" target="_blank" rel="noreferrer">slides</a>
          <a className="link" href="/videos/tessera-demo-voiceover.mp4" target="_blank" rel="noreferrer">demo video</a>
          <a className="link" href="/videos/tessera-demo.mp4" target="_blank" rel="noreferrer">website walkthrough</a>
        </span>
      </div>
    </footer>
  );
}

function Close() {
  return (
    <section id="waitlist" className="night py-28 text-center" style={{ scrollMarginTop: 80 }}>
      <div className="wrap">
        <Reveal>
          <div className="mx-auto flex w-fit gap-2">
            {TIER_DARK.map((c, i) => (
              <motion.span key={c} style={{ width: 10, height: 10, borderRadius: 10, background: c }} animate={{ y: [0, -7, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />
            ))}
          </div>
          <h2 className="display mx-auto mt-8 max-w-[15ch] text-[clamp(2.8rem,7vw,6rem)]" style={{ color: '#f1eee2' }}>
            Micropayments were the easy part. <em>Every payment matters.</em>
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/market" className="btn btn-mint">
              Buy from an agent
            </Link>
            <Link to="/network" className="btn btn-ghost">
              Watch the network
            </Link>
          </div>
          <p className="mx-auto mt-12 max-w-[32rem] text-[1.08rem] leading-relaxed">
            Building an AI agent that buys or sells? Get early access to Tessera.
          </p>
          <div className="mt-6">
            <Waitlist dark />
          </div>
          <p className="mt-4 text-[0.95rem]" style={{ color: '#8b8a7c' }}>
            Questions? <a className="link" href={`mailto:${CONTACT}?subject=Tessera`}>{CONTACT}</a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <div>
      <Nav />
      <Hero />
      <Problem />
      <CreditLayer />
      <Threats />
      <WhyEscrow />
      <HowItWorks />
      <Lanes />
      <TopUp />
      <PayLater />
      <Demo />
      <Developers />
      <Score />
      <Rewards />
      <Attacks />
      <Proof />
      <Close />
      <Footer dark />
    </div>
  );
}
