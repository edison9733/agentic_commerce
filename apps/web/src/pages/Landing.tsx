import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS } from '@tessera/sdk';
import registry from '../../../../deployments/registry.json';
import snapshot from '../../../../deployments/snapshot.json';
import { AttackLab } from '../components/AttackLab';
import { Feed } from '../components/Feed';
import { Graph } from '../components/Graph';
import { Nav } from '../components/Nav';
import { Playground } from '../components/Playground';
import { Counter, EASE, Logo, Reveal, TierBadge, Words } from '../components/ui';
import { compactUsd, duration, explorerAddress, TIER_DARK, tierName } from '../lib/format';
import { Link } from '../lib/router';
import { useChain, useProfiles } from '../lib/store';
import { recordedAt, session } from '../lib/findDemo';

const REPO = 'https://github.com/edison9733/agentic_commerce';
const PROGRAM = 'TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ';

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
          Live on Solana devnet · program TessSe…1CQ
        </motion.a>

        <h1 className="display mx-auto mt-7 text-[clamp(3.2rem,9.2vw,8.2rem)]" style={{ maxWidth: '14ch' }}>
          <Words text="Every payment matters." italic={['matters']} delay={0.1} />
        </h1>

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
          <div className="grid lg:grid-cols-[1fr_340px]">
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
        <div className="eyebrow" style={{ color: '#878371' }}>The gap</div>
        <h2 className="display mt-4 max-w-[19ch] text-[clamp(2.4rem,5.6vw,4.6rem)]">
          An agent can pay in a second. <em>Finding out it was robbed takes longer.</em>
        </h2>
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
          Escrow closes the gap, but a fixed hold is wrong for almost everyone: too long for an agent with a thousand clean orders, too short for a wallet created a minute ago.
          <span style={{ color: '#14130f' }}> The hold should be a function of what is known about the two parties. That function is a credit score.</span>
        </p>
      </Reveal>
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

function Score() {
  return (
    <section className="py-24 md:py-32" style={{ background: '#f4efe0' }}>
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.35fr] lg:items-start">
          <Reveal className="min-w-0">
            <div className="eyebrow" style={{ color: '#878371' }}>The score</div>
            <h2 className="display mt-4 text-[clamp(2.4rem,5vw,4.2rem)]">
              How much is known, <em>times</em> whether it is good.
            </h2>
            <pre className="mono mt-8 overflow-x-auto rounded-2xl p-5 text-[0.82rem] leading-[1.9]" style={{ background: '#14130f', color: '#e9e6d8' }}>
{`score    = 1000 × Evidence × Rating × Behaviour

Evidence = 0.45 History
         + 0.30 Tenure
         + 0.25 Diversity`}
            </pre>
            <p className="mt-6 text-[1.02rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Evidence says how much is known about a wallet. Rating and Behaviour say whether what is known is good. They multiply, so a long history cannot paper over bad reviews or a lost dispute.
            </p>
            <p className="mt-4 text-[1.02rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Every input is a field in a public account and every step is integer arithmetic. This page runs the same code the program does, so the number on the right is the number the chain would store.
            </p>
            <Link to="/formula" className="btn btn-ghost mt-7">
              Read the whole formula
            </Link>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <Playground />
          </Reveal>
        </div>
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
            On-chain data alone cannot tell a bot from a customer spending the same money. What a program can do is make faking cost money and time that never come back, and cap what a fake can then take.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <AttackLab />
        </Reveal>
      </div>
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
  const snippet = SNIPPETS.find((x) => x.id === tab)!;
  const registered = Object.keys(registry.agents).length;
  const mirrored = Object.keys(registry.feedback).length;
  const layers: [string, string, string, boolean][] = [
    ['Payment', 'x402', 'The exact scheme, unchanged. Two public facilitators.', false],
    ['Credit', 'Tessera', 'Whether the money waits, and for how long.', true],
    ['Identity', 'Solana Agent Registry', `ERC-8004 on Solana. ${registered} merchants registered on devnet, ${mirrored} reviews mirrored with proof of payment.`, false],
  ];
  return (
    <section className="night gridded py-24 md:py-32">
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
    ['294 / 294', 'checks pass against the real program on a local validator, each account compared field by field with a reference model'],
    ['18 / 18', 'formula tests pass: every guarantee on this page is a test'],
    ['79 / 79', 'checks pass across the four ways in for agents (HTTP API, MCP, skill, CLI), from finding a merchant to a refund'],
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
          <a className="link" href={REPO} target="_blank" rel="noreferrer">github</a>
        </span>
      </div>
    </footer>
  );
}

function Close() {
  return (
    <section className="night py-28 text-center">
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
      <HowItWorks />
      <Lanes />
      <Developers />
      <Score />
      <Attacks />
      <Proof />
      <Close />
      <Footer dark />
    </div>
  );
}
