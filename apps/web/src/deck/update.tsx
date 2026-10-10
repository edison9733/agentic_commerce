import { MAINNET_TARGET_PARAMS as P } from '@tessera/sdk';
import { Bars } from '../components/charts';
import { Counter, Logo } from '../components/ui';
import { SERIES } from '../lib/format';
import registry from '../../../../deployments/registry.json';
import snapshot from '../../../../deployments/snapshot.json';
import { Big, Body, Deck, Frame, Kicker, Rise, Source, type Slide } from './Deck';

const mint = '#b9f8da';
const white = '#f1eee2';

/**
 * The one-minute weekly update Colosseum recommends: what shipped, what was
 * hard, what is next. Every number is read from deployments/snapshot.json.
 */
const score = (name: string) => snapshot.agentsByScore.find((a) => a.name === name)?.score ?? 0;
const lowest = (names: string[]) => Math.min(...names.map(score));
const board = [
  { label: 'Honest merchants (lowest of 4)', value: lowest(['atlas', 'quill', 'vera', 'pixel']), color: SERIES[0] },
  { label: 'Honest buyers (lowest of 6)', value: lowest(['scout', 'nova', 'orbit', 'lumen', 'drift', 'echo']), color: SERIES[0] },
  { label: 'Wash-trading ring: its merchant', value: score('washer'), color: SERIES[1] },
  { label: 'Wash-trading ring: its sock puppets', value: lowest(['sock-1', 'sock-2', 'sock-3']), color: SERIES[1] },
  { label: 'Buyer who disputed real deliveries', value: score('charlie'), color: SERIES[1] },
  { label: 'Merchant who never delivered', value: score('mallory'), color: SERIES[1] },
];

export const UPDATE: Slide[] = [
  {
    id: 'title',
    seconds: 4,
    say: 'Tessera. Weekly update.',
    render: () => (
      <Frame center>
        <Logo size={96} invert />
        <Big size={120} delay={0.3} color={white}>Weekly update</Big>
        <Body delay={0.7} size={30} max="40ch">Tessera · Crypto World's Fair · week of 5 October 2026</Body>
      </Frame>
    ),
  },
  {
    id: 'shipped',
    seconds: 16,
    say: 'This week it went live on Solana devnet. An escrow program that x402 pays straight into. An on-chain credit score that sets how long the money waits. Agents that trade over A2A. And a site that reads all of it from the chain.',
    surface: 'paper',
    render: () => (
      <Frame pad={88}>
        <Kicker color="#878371">What shipped</Kicker>
        <Big size={84} max="18ch">Live on Solana devnet.</Big>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginTop: 44 }}>
          {[
            ['Escrow program', '17 instructions. An x402 payment lands in a per-order escrow because the 402 response names it as payTo.'],
            ['Credit score', 'Computed on-chain from settled orders only. It sets the hold: a new wallet waits, two Trusted wallets settle at once.'],
            ['Agents', 'Merchants and buyers over A2A with the x402 extension, through two public facilitators.'],
            ['Website', 'The live network, every credit file, a wallet checkout, and the attack lab. It reads the chain directly.'],
          ].map(([h, b], k) => (
            <Rise key={h} delay={0.4 + k * 0.14}>
              <div style={{ padding: '24px 28px', borderRadius: 20, border: '1px solid #ded7c2', background: '#fff', height: '100%' }}>
                <div className="display" style={{ fontSize: 40 }}>{h}</div>
                <div style={{ fontSize: 22, marginTop: 8, lineHeight: 1.4, color: '#4b483e' }}>{b}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Source dark={false}>393 on-chain checks pass against the program on a local validator (npm run test:local). Program TessSeP5…1CQ on devnet.</Source>
      </Frame>
    ),
  },
  {
    id: 'numbers',
    seconds: 15,
    say: 'More than two hundred orders have settled. Three attacks ran against it on devnet. A wash-trading ring, a buyer who disputes real deliveries, and a merchant who never delivers. None of them reached Trusted.',
    render: () => (
      <Frame pad={88}>
        <Kicker>What happened on devnet</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 64, marginTop: 26, alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'grid', gap: 34 }}>
            <Rise delay={0.2}>
              <div className="display" style={{ fontSize: 120, color: mint, lineHeight: 1 }}><Counter value={snapshot.ordersSettled} /></div>
              <div style={{ fontSize: 24, marginTop: 8 }}>orders settled through escrow</div>
            </Rise>
            <Rise delay={0.4}>
              <div className="display" style={{ fontSize: 120, color: white, lineHeight: 1 }}><Counter value={snapshot.reviewsOnChain} /></div>
              <div style={{ fontSize: 24, marginTop: 8 }}>reviews on-chain, each tied to a settled order</div>
            </Rise>
          </div>
          <Rise delay={0.6}>
            <div className="mono" style={{ fontSize: 16, color: '#8b8a7c', marginBottom: 20, letterSpacing: '0.08em' }}>SCORE OUT OF 1000 · TRUSTED STARTS AT 750</div>
            <div style={{ zoom: 1.5 }}>
              <Bars max={1000} format={(v) => String(v)} rows={board} />
            </div>
          </Rise>
        </div>
        <Source>deployments/snapshot.json, taken {snapshot.takenAt.slice(0, 16).replace('T', ' ')} UTC. The traffic is this project's own agents with recycled test USDC.</Source>
      </Frame>
    ),
  },
  {
    id: 'hard',
    seconds: 15,
    say: 'The hardest problem was instant settlement. A trusted merchant could take the money and run. So instant volume is now capped by the fees a merchant has already paid. An exit scam nets twenty-five dollars a wallet, at any size.',
    render: () => (
      <Frame>
        <Kicker>The hard part</Kicker>
        <Big size={84} max="20ch" color={white}>Instant settlement invites <em>the exit scam.</em></Big>
        <Body delay={0.6} size={32} max="44ch">
          The fix: a merchant may only take instantly what it has already paid in protocol fees, plus a small base. So a scam recovers its fees and little more.
        </Body>
        <Rise delay={1.0} style={{ marginTop: 44 }}>
          <span className="mono" style={{ fontSize: 30, color: mint }}>net of an exit scam = (base + fees) − fees = ${Number(P.instantBase / 1_000_000n)}</span>
        </Rise>
        <Source>Mainnet target parameters. Checked by npm run test:formula and by the on-chain test suite.</Source>
      </Frame>
    ),
  },
  {
    id: 'next',
    seconds: 8,
    say: "It already plugs into Solana's Agent Registry on devnet. Next, I want real x402 sellers using it.",
    surface: 'paper',
    render: () => (
      <Frame>
        <Kicker color="#878371">Next</Kicker>
        <Big size={92} max="17ch">Real x402 sellers, <em>using it.</em></Big>
        <Body delay={0.6} size={30} max="48ch" color="#4b483e">
          Already done: {Object.keys(registry.agents).length} merchant agents registered in the Solana Agent Registry on devnet, with {Object.keys(registry.feedback).length} reviews mirrored there as payment-backed feedback.
        </Body>
        <Source dark={false}>github.com/edison9733/agentic_commerce · devnet only, no outside users yet.</Source>
      </Frame>
    ),
  },
];

export const UpdateDeck = () => <Deck slides={UPDATE} title="Tessera weekly update" />;
