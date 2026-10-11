import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import registry from '../../../../deployments/registry.json';
import { Nav } from '../components/Nav';
import { EASE, Reveal } from '../components/ui';
import { session, recordedAt } from '../lib/findDemo';
import { Footer } from './Landing';

const REPO = 'https://github.com/edison9733/agentic_commerce';

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

function DevelopersSection() {
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
    <section id="developers" className="night gridded py-20 md:py-28">
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

export function Developers() {
  useEffect(() => window.scrollTo(0, 0), []);
  return (
    <div className="night" style={{ minHeight: '100dvh' }}>
      <Nav dark />
      <DevelopersSection />
      <Footer dark />
    </div>
  );
}
