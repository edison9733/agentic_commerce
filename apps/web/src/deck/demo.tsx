import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { fetchMaybeToken } from '@solana-program/token';
import { findAta, USDC_DEVNET } from '@tessera/sdk';
import { EASE, Logo } from '../components/ui';
import { loadBurner } from '../lib/burner';
import { AGENTS_URL, readRpc } from '../lib/client';
import { useProfiles } from '../lib/store';
import { Big, Body, Deck, Frame, Kicker, Rise, Source, type Slide } from './Deck';

const mint = '#b9f8da';
const white = '#f1eee2';

/** A caption bar over live footage, so the site itself stays the subject. */
const Caption = ({ children, side = false }: { children: React.ReactNode; side?: boolean }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: EASE, delay: 0.6 }}
    style={{
      position: 'absolute',
      // beside a centred dialog rather than over its buttons
      ...(side ? { left: 40, top: 300, width: 380 } : { left: 48, right: 48, bottom: 40 }),
      padding: '18px 26px',
      borderRadius: 18,
      background: 'rgba(10,11,9,0.9)',
      border: '1px solid #272b21',
      color: white,
      fontSize: side ? 23 : 27,
      lineHeight: 1.35,
      backdropFilter: 'blur(8px)',
    }}
  >
    {children}
  </motion.div>
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The live site inside a slide. It is the real app on the same origin, so a
 * slide can scroll it and press its buttons: the demo is performed, not faked.
 */
function Live({ route, run, zoom = 1 }: { route: string; run?: (doc: Document, win: Window) => Promise<void>; zoom?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let cancelled = false;
    const frame = ref.current!;
    const go = async () => {
      await sleep(1800);
      if (cancelled || !run || !frame.contentDocument || !frame.contentWindow) return;
      try {
        await run(frame.contentDocument, frame.contentWindow);
      } catch {
        // a missing element just means the tour skips that beat
      }
    };
    frame.addEventListener('load', () => void go(), { once: true });
    return () => {
      cancelled = true;
    };
  }, [run]);
  const base = `${window.location.origin}${window.location.pathname}`;
  return <iframe ref={ref} title={route} src={`${base}#${route}`} style={{ position: 'absolute', left: 0, top: 0, width: `${100 / zoom}%`, height: `${100 / zoom}%`, border: 0, transform: `scale(${zoom})`, transformOrigin: '0 0', background: '#fbf8ef' }} />;
}

const press = (doc: Document, text: string, nth = 0): boolean => {
  const b = [...doc.querySelectorAll('button')].filter((x) => x.textContent?.trim().startsWith(text))[nth] as HTMLButtonElement | undefined;
  if (!b || b.disabled) return false;
  b.click();
  return true;
};

const waitFor = async (doc: Document, test: () => boolean, ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until && !test()) await sleep(400);
  void doc;
};

/** Buy an identicon with the built-in test wallet, then confirm receipt. A real devnet purchase. */
async function buyTour(doc: Document) {
  await waitFor(doc, () => /\$\d+\.\d\d USDC/.test(doc.body.innerText), 10_000);
  if (/\$0\.[01]\d USDC/.test(doc.body.innerText)) {
    press(doc, 'Get test funds');
    await waitFor(doc, () => !/\$0\.[01]\d USDC/.test(doc.body.innerText), 20_000);
  }
  press(doc, 'Buy', 3);
  await sleep(1500);
  press(doc, 'Pay');
  await waitFor(doc, () => /In escrow|Settled|Released early/i.test(doc.body.innerText), 45_000);
  await sleep(3500);
  press(doc, 'Release now');
}

async function profileTour(doc: Document, win: Window) {
  await sleep(2500);
  win.scrollTo({ top: 620, behavior: 'smooth' });
  await sleep(4500);
  win.scrollTo({ top: 1100, behavior: 'smooth' });
}

function ProfileScene() {
  const { profiles } = useProfiles();
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    if (who) return;
    const best = profiles.find((p) => p.role === 'merchant' && p.eval.tier === 3) ?? profiles.find((p) => p.role === 'merchant');
    if (best) setWho(best.wallet);
  }, [profiles, who]);
  return who ? <Live route={`/agents/${who}`} run={profileTour} /> : null;
}

const TERMINAL = [
  ['$', 'npm run buy -- --buyer scout --merchant atlas --mode x402'],
  ['', '[scout] Atlas/telemetry: 0.20 USDC into escrow JE6F5J7i, hold 120s (merchant New, me New)'],
  ['', 'order      JE6F5J7iVDJ7h6p42uNdwZ2up4BVjhzwu6VrL711WdUW'],
  ['', 'amount     0.20 USDC, paid via x402 facilitator (buyer paid no SOL)'],
  ['', 'settle tx  2w7bzSrNK9nT8zJDdE19qZA5SdoMZxpfFWZPkTXmMsEXCqrBwmyT…'],
  ['', 'delivered  {"cluster":"devnet","slot":507451535,"epoch":1174,"tps":58,…}'],
  ['ok', 'hash check matches the hash committed on-chain'],
  ['', 'settlement held until 18:11:50Z (120s)'],
  ['ok', 'final      Released'],
  ['ok', 'scout SOL before: 0.049995   after: 0.049995'],
] as const;

const box = (x: number, y: number, w: number, title: string, sub: string, delay: number, accent = false) => (
  <motion.g initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay }}>
    <rect x={x} y={y} width={w} height={92} rx={16} fill="#10120e" stroke={accent ? mint : '#272b21'} strokeWidth={accent ? 2 : 1.5} />
    <text x={x + 22} y={y + 40} fontSize={25} fill={white} style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{title}</text>
    <text x={x + 22} y={y + 68} fontSize={16} fill="#8b8a7c" className="mono">{sub}</text>
  </motion.g>
);

export const DEMO: Slide[] = [
  {
    id: 'title',
    seconds: 6,
    say: 'This is how Tessera works, in under three minutes.',
    render: () => (
      <Frame center>
        <Logo size={84} invert />
        <Big size={110} delay={0.3} color={white}>How Tessera works</Big>
        <Body delay={0.8} size={32} max="40ch">One Solana program, two open protocols, and a website that reads the chain directly.</Body>
      </Frame>
    ),
  },
  {
    id: 'accounts',
    seconds: 21,
    say: 'One Anchor program, five kinds of account. Config holds the rules. Each wallet has an Agent account, its credit file. Each buyer and merchant pair has a Pair account. Each purchase is an Order, which owns the vault. Each rating is a Review, stored on-chain in full.',
    render: () => (
      <Frame pad={72}>
        <Kicker>The program · TessSeP5…1CQ · Anchor 1.1 · 17 instructions</Kicker>
        <Big size={64} color={white}>Five accounts. <em>Everything else is derived.</em></Big>
        <svg viewBox="0 0 1456 560" width="100%" style={{ marginTop: 26 }}>
          {box(40, 40, 400, 'Config', '["config"] · every rule, on-chain', 0.3)}
          {box(40, 180, 400, 'Agent', '["agent", wallet] · the credit file', 0.5, true)}
          {box(40, 320, 400, 'Pair', '["pair", buyer, merchant] · their history', 0.7)}
          {box(528, 180, 400, 'Order', '["order", order_id] · the escrow', 0.9, true)}
          {box(1016, 180, 400, 'Vault', 'token account owned by the Order', 1.1)}
          {box(528, 320, 400, 'Review', '["review", order, reviewer] · text on-chain', 1.3)}
          <motion.path d="M 440 226 L 528 226 M 928 226 L 1016 226 M 440 366 Q 484 366 528 250 M 728 272 L 728 320" stroke="#3a3f33" strokeWidth={2} fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay: 1.3 }} />
          <motion.text x={1016} y={320} fontSize={19} fill={mint} className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }}>x402 payTo = the Order account</motion.text>
          <motion.text x={1016} y={350} fontSize={17} fill="#8b8a7c" className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.0 }}>so a plain x402 transfer lands in escrow</motion.text>
          <motion.text x={40} y={470} fontSize={19} fill="#8b8a7c" className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2 }}>score, tier and penalties live in Agent · credit caps and dispute history live in Pair</motion.text>
          <motion.text x={40} y={502} fontSize={19} fill="#8b8a7c" className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}>hold, tiers and the instant flag are snapshotted into Order when it is opened</motion.text>
        </svg>
      </Frame>
    ),
  },
  {
    id: 'trick',
    seconds: 19,
    say: 'The x402 exact scheme on Solana allows only a plain token transfer, so an escrow instruction has nowhere to go. But the destination is derived from pay-to. So the merchant quotes the order account as pay-to, and the money lands in the vault. The program reads the vault balance. It trusts nobody’s word.',
    render: () => (
      <Frame pad={84}>
        <Kicker>The one design decision everything rests on</Kicker>
        <Big size={70} max="22ch" color={white}>The program trusts a balance, <em>not a message.</em></Big>
        <Rise delay={0.6} style={{ marginTop: 40 }}>
          <pre className="mono" style={{ fontSize: 24, lineHeight: 1.65, margin: 0, padding: '30px 36px', borderRadius: 22, background: '#10120e', border: '1px solid #272b21', color: '#c9c6b6' }}>
<span style={{ color: '#5d5c52' }}>{'/// Permissionless on purpose: the only input it trusts is the vault balance.'}</span>{`
pub fn confirm_funded(ctx: Context<ConfirmFunded>) -> Result<()> {
    let vault_balance = ctx.accounts.vault.amount;
    let order = &mut ctx.accounts.order;
    require!(order.state == OrderState::AwaitingPayment, TesseraError::InvalidState);
    `}<span style={{ color: mint }}>{'require!(vault_balance >= order.amount, TesseraError::VaultUnderfunded);'}</span>{`
    order.state = OrderState::Funded;
    ...
}`}
          </pre>
        </Rise>
        <Body delay={1.0} size={27} max="60ch">
          A facilitator can refuse a payment but cannot redirect one: the buyer's signature fixes recipient, amount and mint. A dishonest merchant server cannot either: the buyer re-derives the escrow address and reads the order from the chain before signing.
        </Body>
        <Source>programs/tessera/src/lib.rs. A July 2026 study found rule violations in all 15 x402 facilitators it tested (arXiv 2607.19545), which is why nothing here trusts one.</Source>
      </Frame>
    ),
  },
  {
    id: 'network',
    seconds: 24,
    surface: 'paper',
    say: 'This is the network, read from devnet in the browser. No indexer, no database. Squares are merchants, circles are buyers. A coin on a line is money in escrow, with its hold running down. Bright nodes are Trusted. The small cluster on its own is a wash-trading ring.',
    render: () => (
      <>
        <Live route="/network" />
        <Caption>Every node is an account, every line a pair, every coin an order. Read with four <span className="mono" style={{ color: mint }}>getProgramAccounts</span> calls, decoded in the browser.</Caption>
      </>
    ),
  },
  {
    id: 'terminal',
    seconds: 24,
    say: 'Here one agent buys from another. It reads the merchant’s A2A card, gets a 402, checks the escrow on-chain, and pays through the facilitator. The merchant delivers and commits a hash, and the buyer checks it. Two unknown wallets, so the money was held. The buyer’s SOL balance never moved.',
    render: () => (
      <Frame pad={84}>
        <Kicker>Agent to agent, over A2A and x402 · captured from devnet</Kicker>
        <div style={{ marginTop: 30, borderRadius: 22, background: '#050605', border: '1px solid #272b21', padding: '30px 34px', flex: 1 }}>
          {TERMINAL.map(([tag, line], k) => (
            <motion.div key={k} className="mono" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.6 + k * 1.7 }} style={{ fontSize: 21.5, lineHeight: 2.05, color: tag === 'ok' ? mint : tag === '$' ? white : '#c9c6b6', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {tag === '$' ? '$ ' : tag === 'ok' ? '✓ ' : '  '}
              {line}
            </motion.div>
          ))}
        </div>
      </Frame>
    ),
  },
  {
    id: 'score',
    seconds: 19,
    say: 'The score is integer arithmetic over those accounts, written once in Rust and once in TypeScript. A test suite runs the real program on a local validator and compares every account with the model after every instruction. Two hundred and ninety-four checks, attacks included.',
    render: () => (
      <Frame pad={84}>
        <Kicker>One formula, three places: program, SDK, browser</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 44, marginTop: 30, alignItems: 'start' }}>
          <Rise delay={0.3}>
            <pre className="mono" style={{ fontSize: 20.5, lineHeight: 1.7, margin: 0, padding: '28px 32px', borderRadius: 22, background: '#10120e', border: '1px solid #272b21', color: '#c9c6b6' }}>
{`let history  = isqrt(credit * 1_000_000 / credit_full).min(1000);
let effective = age_periods.min(active_periods * 3);
let tenure   = (effective * 1000 / tenure_full).min(1000);
let diversity = (points * 1000 / diversity_full).min(1000);

let evidence = (450 * history + 300 * tenure
              + 250 * diversity) / 1000;

`}<span style={{ color: mint }}>{'let score = evidence * rating * behaviour / (1000 * BPS);'}</span>
            </pre>
          </Rise>
          <div style={{ display: 'grid', gap: 26 }}>
            <Rise delay={0.7}>
              <div className="display" style={{ fontSize: 100, color: white, lineHeight: 1 }}>294<span style={{ fontSize: 46, color: '#8b8a7c' }}> / 294</span></div>
              <div style={{ fontSize: 23, marginTop: 8 }}>checks against the real program, each account compared with a reference model</div>
            </Rise>
            <Rise delay={1.0}>
              <div className="display" style={{ fontSize: 100, color: white, lineHeight: 1 }}>18<span style={{ fontSize: 46, color: '#8b8a7c' }}> / 18</span></div>
              <div style={{ fontSize: 23, marginTop: 8 }}>formula tests: every guarantee we state is one</div>
            </Rise>
          </div>
        </div>
        <Source>programs/tessera/src/score.rs · packages/sdk/src/score.ts · npm run test:local · npm run test:formula</Source>
      </Frame>
    ),
  },
  {
    id: 'checkout',
    seconds: 36,
    surface: 'paper',
    say: 'A person can buy from the same agents with a wallet. The merchant opens the escrow. The browser checks it on-chain before paying. The payment goes into the vault. The merchant delivers, and the hash of what arrived matches the one on-chain. This buyer is new, so the money is held. Here it confirms receipt, and the merchant is paid.',
    render: () => (
      <>
        <Live route="/market" run={buyTour} />
        <Caption side>A real purchase on devnet, performed by this slide: escrow opened, verified in the browser, paid, delivered, hash checked, released.</Caption>
      </>
    ),
  },
  {
    id: 'profile',
    seconds: 16,
    surface: 'paper',
    say: 'Every wallet has a credit file anyone can read: the score and what it is made of, the instant limit, and every review with the weight it carried. This merchant is also in Solana’s Agent Registry, where its reviews are mirrored with proof of payment.',
    render: () => (
      <>
        <ProfileScene />
        <Caption>A merchant that earned Trusted on devnet. Score, evidence, instant limit and reviews are all fields of public accounts.</Caption>
      </>
    ),
  },
  {
    id: 'stack',
    seconds: 15,
    say: 'The stack: Anchor, Solana Kit and Codama, x402 version two, A2A, and the Solana Agent Registry. Agents call it over an API, MCP, a skill or a CLI. It is on devnet, with time compressed, one arbiter key, and no audit. Those come next.',
    render: () => (
      <Frame pad={84}>
        <Kicker>Stack, and what is not done</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 44, marginTop: 34 }}>
          <div>
            {[
              ['Program', 'Anchor 1.1.2 · 472 KB · devnet'],
              ['Clients', '@solana/kit 8 · Codama-generated'],
              ['Payments', 'x402 v2 `exact` · two facilitators quoted per order'],
              ['Agents', 'A2A JSON-RPC · a2a-x402 extension v0.2'],
              ['Identity', 'Solana Agent Registry (ERC-8004) · reviews mirrored'],
              ['For agents', 'HTTP API · MCP · skill · CLI · find_merchants ranks sellers'],
              ['Website', 'React · Motion · reads the chain directly'],
            ].map(([k, v], i) => (
              <Rise key={k} delay={0.3 + i * 0.12}>
                <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', padding: '13px 0', borderTop: '1px solid #272b21', fontSize: 25 }}>
                  <span style={{ color: white }}>{k}</span>
                  <span className="mono" style={{ fontSize: 20 }}>{v}</span>
                </div>
              </Rise>
            ))}
          </div>
          <div>
            {['Devnet only; the demo traffic is our own agents', 'Time is compressed 1,440 to 1: a period is a minute, not a day', 'The arbiter and the upgrade authority are single keys', 'The program is unaudited', 'A2A endpoint is hand-rolled, not yet run against the official test kit'].map((t, i) => (
              <Rise key={t} delay={0.5 + i * 0.12}>
                <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', padding: '16px 0', borderTop: '1px solid #272b21', fontSize: 24 }}>
                  <span style={{ color: '#ec835a' }}>○</span>
                  <span>{t}</span>
                </div>
              </Rise>
            ))}
          </div>
        </div>
        <Rise delay={1.4} style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={36} invert />
          <span className="mono" style={{ fontSize: 22 }}>github.com/edison9733/agentic_commerce</span>
        </Rise>
      </Frame>
    ),
  },
];

/**
 * Fund the built-in test wallet from the demo faucet as soon as the deck
 * opens, so the purchase slide can spend its time on the purchase.
 */
function usePrefund() {
  useEffect(() => {
    void (async () => {
      try {
        const burner = await loadBurner();
        const token = await fetchMaybeToken(readRpc, await findAta(burner.address, USDC_DEVNET));
        if (token.exists && token.data.amount >= 150_000n) return;
        await fetch(`${AGENTS_URL}/api/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: burner.address }) });
      } catch {
        // the purchase slide asks for funds itself if this did not work
      }
    })();
  }, []);
}

export function DemoDeck() {
  usePrefund();
  return <Deck slides={DEMO} title="Tessera technical demo" />;
}
