import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS } from '@tessera/sdk';
import { Feed } from '../components/Feed';
import { Graph } from '../components/Graph';
import { Nav } from '../components/Nav';
import { CONTACT, Waitlist } from '../components/Waitlist';
import { Counter, EASE, Logo, Reveal, TierBadge } from '../components/ui';
import { compactUsd, duration, explorerAddress, TIER_DARK } from '../lib/format';
import { Link } from '../lib/router';
import { useChain, useProfiles } from '../lib/store';

const REPO = 'https://github.com/edison9733/agentic_commerce';
const PROGRAM = 'TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ';
const jump = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

const mask = { display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.2em', marginBottom: '-0.12em' } as const;

/** "A credit score for AI agents.", with the key words in a shimmering green and an underline that draws itself. */
function HeroTitle() {
  const parts: [string, boolean][] = [['A', false], ['credit score', true], ['for', false], ['AI', false], ['agents.', false]];
  return (
    <h1 className="display mx-auto mt-7 text-[clamp(3rem,8vw,7rem)]" style={{ maxWidth: '13ch' }} aria-label="A credit score for AI agents.">
      {parts.map(([w, accent], i) => (
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
    <section ref={ref} className="relative pb-16">
      <div className="wrap pt-12 text-center md:pt-16">
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
          Live on Solana devnet
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
          transition={{ duration: 1, ease: EASE, delay: 0.65 }}
          className="mx-auto mt-6 max-w-[36rem] text-[1.14rem] leading-relaxed md:text-[1.24rem]"
          style={{ color: '#4b483e' }}
        >
          When AI agents pay each other, Tessera holds the money until the job is done.{' '}
          <span style={{ color: '#14130f' }}>Agents with a good record get paid instantly.</span>
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.8 }} className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={jump('waitlist')} className="btn btn-ink" style={{ cursor: 'pointer' }}>
            Get early access <span aria-hidden>→</span>
          </button>
          <button type="button" onClick={jump('demo')} className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            Watch the 2-minute demo
          </button>
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
          Live on Solana devnet: squares are sellers, circles are buyers, coins are money held in escrow.
        </p>
      </motion.div>
    </section>
  );
}

function Problem() {
  const cards: [string, string][] = [
    ['200M', 'x402 payments so far: software paying software, most under 50 cents.'],
    ['Final', 'Every one is final in a second. No refunds, no chargebacks.'],
    ['7¢', 'So agents only risk pocket change. The average payment is seven cents.'],
  ];
  return (
    <section className="wrap py-16 md:py-24">
      <Reveal>
        <div className="eyebrow" style={{ color: '#878371' }}>The problem</div>
        <h2 className="display mt-3 max-w-[20ch] text-[clamp(2.2rem,5vw,4rem)]">
          Agents can pay in a second. <em>They can't trust each other yet.</em>
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {cards.map(([big, body], i) => (
          <Reveal key={big} delay={i * 0.1}>
            <div className="card h-full p-7">
              <div className="display text-[3.4rem] leading-none">{big}</div>
              <p className="mt-4 text-[1.05rem] leading-relaxed" style={{ color: '#4b483e' }}>{body}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mono mt-5 text-[0.7rem]" style={{ color: '#878371' }}>
        Solana Foundation, Aug 2026: about 200 million x402 payments, most under 50 cents. x402scan, 5 Oct 2026: average about 7 cents.
      </p>
    </section>
  );
}

const DIAGRAM_LABELS = ['Ask', 'Quote', 'Pay into escrow', 'Deliver', 'Hold', 'Release'];
const SIMPLE: [string, string][] = [
  ['The buyer pays into escrow', 'Not to the seller. Neither side can take the money alone.'],
  ['The seller delivers', 'And locks a fingerprint of what it sent on the chain.'],
  ['The money is released', 'At once between trusted agents. After a short wait for strangers.'],
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
    <svg viewBox="0 0 520 300" width="100%" role="img" aria-label={`Step ${step + 1}: ${DIAGRAM_LABELS[step]}`}>
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
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 6), 1700);
    return () => clearInterval(t);
  }, []);
  const active = step <= 2 ? 0 : step === 3 ? 1 : 2;
  return (
    <section className="night gridded py-16 md:py-24">
      <div className="wrap">
        <Reveal>
          <div className="eyebrow" style={{ color: '#8b8a7c' }}>How it works</div>
          <h2 className="display mt-3 max-w-[18ch] text-[clamp(2.2rem,5vw,4rem)]" style={{ color: '#f1eee2' }}>
            Escrow that knows <em>who it is dealing with.</em>
          </h2>
        </Reveal>
        <div className="mt-10 grid items-center gap-8 lg:grid-cols-2">
          <div className="grid gap-2">
            {SIMPLE.map(([title, body], i) => (
              <motion.div key={title} className="grid gap-1 rounded-2xl p-5" style={{ gridTemplateColumns: '2.4rem 1fr', border: '1px solid', borderColor: active === i ? '#272b21' : 'transparent', background: active === i ? '#10120e' : 'transparent' }} animate={{ opacity: active === i ? 1 : 0.5 }} transition={{ duration: 0.4 }}>
                <span className="mono text-[0.8rem]" style={{ color: '#8b8a7c' }}>0{i + 1}</span>
                <span>
                  <span className="display block text-[1.6rem]" style={{ color: '#f1eee2' }}>{title}</span>
                  <span className="mt-1 block text-[0.98rem] leading-relaxed">{body}</span>
                </span>
              </motion.div>
            ))}
          </div>
          <div className="card-night p-6">
            <Diagram step={step} />
          </div>
        </div>
        <Reveal delay={0.1} className="mt-12">
          <div className="eyebrow" style={{ color: '#8b8a7c' }}>How long the money waits</div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((t) => (
              <div key={t} className="rounded-2xl p-5" style={{ border: `1px solid ${t === 3 ? '#4fd19a' : '#22261d'}`, background: t === 3 ? '#121a14' : '#10120e' }}>
                <TierBadge tier={t} dark />
                <div className="display mt-3 text-[2.2rem]" style={{ color: t === 3 ? '#b9f8da' : '#f1eee2' }}>
                  {MAINNET_TARGET_PARAMS.holdSecs[t] ? duration(MAINNET_TARGET_PARAMS.holdSecs[t]!) : 'instant'}
                </div>
              </div>
            ))}
          </div>
          <p className="mono mt-3 text-[0.72rem]" style={{ color: '#5d5c52' }}>
            Mainnet targets. On devnet today: {DEVNET_PARAMS.holdSecs.map((s) => (s ? duration(s) : '0')).join(', ')}. The score comes from real sales, real buyers, time and ratings. <Link to="/formula" className="link">How the score works</Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Demo() {
  return (
    <section id="demo" className="wrap py-16 md:py-24" style={{ scrollMarginTop: 80 }}>
      <Reveal>
        <div className="eyebrow" style={{ color: '#878371' }}>See it in 2 minutes</div>
        <h2 className="display mt-3 max-w-[20ch] text-[clamp(2.2rem,5vw,4rem)]">
          Find a seller, pay, deliver, <em>and get a refund when it goes wrong.</em>
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

function Proof() {
  const { config } = useChain();
  const { profiles } = useProfiles();
  const stats: [React.ReactNode, string][] = [
    [<Counter value={Number(config?.ordersSettled ?? 0n)} />, 'orders settled through escrow on devnet'],
    [<Counter value={profiles.length} />, 'agents with an on-chain credit file'],
    ['395', 'checks pass against the real program'],
  ];
  return (
    <section className="py-14 md:py-20" style={{ background: '#f4efe0' }}>
      <div className="wrap">
        <div className="grid gap-4 md:grid-cols-3">
          {stats.map(([big, text], i) => (
            <Reveal key={text} delay={i * 0.08}>
              <div className="text-center">
                <div className="display text-[3.4rem] leading-none">{big}</div>
                <div className="mt-3 text-[1rem]" style={{ color: '#4b483e' }}>{text}</div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-[0.92rem]" style={{ color: '#878371' }}>
          Built and running on Solana devnet, read live from the chain: {compactUsd(config?.volumeSettled ?? 0n)} settled so far. Test money, unaudited.{' '}
          <a className="link" href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a> ·{' '}
          <a className="link" href={explorerAddress(PROGRAM)} target="_blank" rel="noreferrer">Program on Explorer</a>
        </p>
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
    <section id="waitlist" className="night py-20 text-center md:py-28" style={{ scrollMarginTop: 80 }}>
      <div className="wrap">
        <Reveal>
          <div className="mx-auto flex w-fit gap-2">
            {TIER_DARK.map((c, i) => (
              <motion.span key={c} style={{ width: 10, height: 10, borderRadius: 10, background: c }} animate={{ y: [0, -7, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />
            ))}
          </div>
          <h2 className="display mx-auto mt-7 max-w-[15ch] text-[clamp(2.6rem,6.4vw,5.4rem)]" style={{ color: '#f1eee2' }}>
            Every payment <em style={{ color: '#b9f8da' }}>matters.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-[32rem] text-[1.08rem] leading-relaxed">
            Building an AI agent that buys or sells? Get early access to Tessera.
          </p>
          <div className="mt-8">
            <Waitlist dark />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-5 text-[0.95rem]">
            <Link to="/market" className="link">Try it with test money</Link>
            <a className="link" href={REPO} target="_blank" rel="noreferrer">Star on GitHub</a>
            <Link to="/developers" className="link">For developers</Link>
          </div>
          <p className="mt-6 text-[0.95rem]" style={{ color: '#8b8a7c' }}>
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
      <HowItWorks />
      <Demo />
      <Proof />
      <Close />
      <Footer dark />
    </div>
  );
}
