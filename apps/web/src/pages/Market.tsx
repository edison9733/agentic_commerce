import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { address, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { fetchMaybeToken, getTransferCheckedInstruction } from '@solana-program/token';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import {
  agentPdaOf,
  bytesEqual,
  fetchMaybeOrder,
  findAta,
  fromHex,
  getConfirmFundedInstructionAsync,
  getOpenDisputeInstruction,
  getReleaseInstruction,
  getSubmitReviewInstructionAsync,
  hashJson,
  OrderState,
  pairPdaOf,
  score,
  settleAccounts,
  sha256,
  USDC_DEVNET,
  verifyOrderForPayment,
  type Order,
} from '@tessera/sdk';
import { Footer } from './Landing';
import { Nav } from '../components/Nav';
import { Addr, EASE, Reveal, TierBadge } from '../components/ui';
import { loadBurner, sendWith } from '../lib/burner';
import { AGENTS_URL, readRpc, type AppClient } from '../lib/client';
import { duration, explorerAddress, explorerTx, short, tierName, usd } from '../lib/format';
import { refresh, useChain, useProfiles } from '../lib/store';

type Item = { merchant: string; merchantWallet: string; title: string; sku: string; name: string; description: string; price: string; example: Record<string, unknown> };
type Terms = { orderId: string; order: string; vault: string; merchant: string; buyer: string; amount: string; mint: string; holdSecs: number; buyerTier: string; merchantTier: string; pairTrusted: boolean; requestHash: string; openTx: string };
type Step = { label: string; detail?: React.ReactNode; state: 'todo' | 'doing' | 'done' | 'failed' };

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${AGENTS_URL}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
  return json;
};

/** Whoever is paying: a connected wallet, or the built-in devnet test wallet. */
function usePayer() {
  const client = useClient<AppClient>();
  const connected = useConnectedWallet(client);
  const [burner, setBurner] = useState<TransactionSigner | null>(null);
  useEffect(() => {
    void loadBurner().then(setBurner);
  }, []);
  return useMemo(() => {
    if (connected) {
      const signer = (client as unknown as { payer: TransactionSigner }).payer;
      return {
        kind: 'wallet' as const,
        address: connected.account.address as Address,
        signer,
        send: async (ixs: Instruction[]) => {
          const out = await client.sendTransaction(ixs);
          return (out as { context: { signature: string } }).context.signature;
        },
      };
    }
    if (!burner) return null;
    return { kind: 'burner' as const, address: burner.address, signer: burner, send: (ixs: Instruction[]) => sendWith(burner, ixs) };
  }, [client, connected, burner]);
}

function useBalances(owner?: Address) {
  const [b, setB] = useState<{ sol: bigint; usdc: bigint } | null>(null);
  const load = useCallback(async () => {
    if (!owner) return;
    try {
      const [sol, token] = await Promise.all([readRpc.getBalance(owner).send(), fetchMaybeToken(readRpc, await findAta(owner, USDC_DEVNET))]);
      setB({ sol: sol.value, usdc: token.exists ? token.data.amount : 0n });
    } catch {
      // keep the last known balances
    }
  }, [owner]);
  useEffect(() => {
    setB(null);
    void load();
    const t = setInterval(load, 9000);
    return () => clearInterval(t);
  }, [load]);
  return { balances: b, reload: load };
}

function Deliverable({ value }: { value: unknown }) {
  const svg = typeof value === 'object' && value !== null && typeof (value as { svg?: unknown }).svg === 'string' ? (value as { svg: string }).svg : null;
  return (
    <div className="rounded-2xl p-4" style={{ background: '#14130f', color: '#e9e6d8' }}>
      {svg && <img alt="Generated identicon" width={96} height={96} style={{ borderRadius: 12, background: '#0a0b09', marginBottom: 12 }} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />}
      <pre className="mono overflow-x-auto text-[0.76rem] leading-relaxed" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(svg ? { ...(value as object), svg: '<svg …>' } : value, null, 2)}
      </pre>
    </div>
  );
}

function Checkout({ item, payer, onClose, onBalance }: { item: Item; payer: NonNullable<ReturnType<typeof usePayer>>; onClose: () => void; onBalance: () => void }) {
  const { config } = useChain();
  const [input, setInput] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(item.example).map(([k, v]) => [k, k === 'wallet' ? payer.address : String(v)])),
  );
  const [extraHold, setExtraHold] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [deliverable, setDeliverable] = useState<unknown>(undefined);
  const [now, setNow] = useState(Date.now() / 1000);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(t);
  }, []);

  const mark = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const reload = useCallback(async (addr: string) => {
    const o = await fetchMaybeOrder(readRpc, address(addr));
    if (o.exists) setOrder(o.data);
    return o.exists ? o.data : null;
  }, []);

  // keep the order fresh while it is held
  useEffect(() => {
    if (!terms || !order || order.state !== OrderState.Delivered) return;
    const t = setInterval(() => void reload(terms.order), 4000);
    return () => clearInterval(t);
  }, [terms, order, reload]);

  const buy = async () => {
    setBusy(true);
    setError(null);
    setSteps([
      { label: 'Merchant opens an escrow for you', state: 'doing' },
      { label: 'Your browser checks the escrow on-chain', state: 'todo' },
      { label: 'You pay into the escrow', state: 'todo' },
      { label: 'Merchant delivers and commits the hash', state: 'todo' },
    ]);
    let at = 0;
    try {
      const body = { merchant: item.merchant, sku: item.sku, input, buyer: payer.address, minHoldSecs: extraHold ? 60 : 0 };
      const { terms: t } = await api<{ terms: Terms }>('/api/orders', body);
      setTerms(t);
      mark(0, { state: 'done', detail: <>order <a className="link mono" href={explorerAddress(t.order)} target="_blank" rel="noreferrer">{short(t.order, 6)}</a> · hold {duration(t.holdSecs)} (merchant {t.merchantTier}, you {t.buyerTier}{t.pairTrusted ? ', history on record' : ''})</> });

      at = 1;
      mark(1, { state: 'doing' });
      let verified: Awaited<ReturnType<typeof verifyOrderForPayment>> | undefined;
      for (let i = 0; !verified; i += 1) {
        try {
          verified = await verifyOrderForPayment(readRpc, {
            orderId: fromHex(t.orderId),
            buyer: payer.address,
            merchant: address(item.merchantWallet),
            amount: BigInt(item.price),
            mint: USDC_DEVNET,
            payTo: address(t.order),
            requestHash: await hashJson({ sku: item.sku, input }),
            minHoldSecs: extraHold ? 60 : undefined,
          });
        } catch (e) {
          if (i >= 8 || !/does not exist/.test((e as Error).message)) throw e;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      mark(1, { state: 'done', detail: 'buyer is you · merchant, amount, mint and request hash match · the address to pay is the escrow derived from the order id' });

      at = 2;
      mark(2, { state: 'doing', detail: payer.kind === 'wallet' ? 'Approve the transfer in your wallet…' : undefined });
      const sig = await payer.send([
        getTransferCheckedInstruction({ source: await findAta(payer.address, USDC_DEVNET), mint: USDC_DEVNET, destination: verified.vault, authority: payer.signer, amount: BigInt(item.price), decimals: 6 }),
        await getConfirmFundedInstructionAsync({ order: verified.order, mint: USDC_DEVNET }),
      ]);
      mark(2, { state: 'done', detail: <>{usd(BigInt(item.price))} in the vault · <a className="link mono" href={explorerTx(sig)} target="_blank" rel="noreferrer">transaction</a> · the program confirmed funding from the vault balance</> });
      onBalance();

      at = 3;
      mark(3, { state: 'doing' });
      const f = await api<{ deliverable: unknown; deliveryHash: string; instant: boolean; releaseAt: number }>(`/api/orders/${t.order}/fulfil`, {});
      const o = await reload(t.order);
      const matches = o !== null && bytesEqual(await hashJson(f.deliverable), o.deliveryHash);
      setDeliverable(f.deliverable);
      mark(3, { state: matches ? 'done' : 'failed', detail: matches ? `sha256 of what you received equals the hash on-chain (${f.deliveryHash.slice(0, 12)}…)` : 'What you received does NOT match the hash on-chain. Dispute it.' });
      void refresh();
    } catch (e) {
      mark(at, { state: 'failed' });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (what: 'release' | 'dispute' | 'review') => {
    if (!terms || !order || !config) return;
    setBusy(true);
    setError(null);
    try {
      const orderAddr = address(terms.order);
      if (what === 'release') {
        await payer.send([getReleaseInstruction({ ...(await settleAccounts(orderAddr, order, config.treasury)), authority: payer.signer })]);
      } else if (what === 'dispute') {
        await payer.send([
          getOpenDisputeInstruction({
            order: orderAddr,
            buyerAgent: await agentPdaOf(order.buyer),
            merchantAgent: await agentPdaOf(order.merchant),
            pair: await pairPdaOf(order.buyer, order.merchant),
            buyer: payer.signer,
            disputeHash: await sha256('disputed from the website'),
          }),
        ]);
      } else {
        await payer.send([
          await getSubmitReviewInstructionAsync({ order: orderAddr, subject: order.merchant, pair: await pairPdaOf(order.buyer, order.merchant), reviewer: payer.signer, payer: payer.signer, rating, text }),
        ]);
        setReviewed(true);
      }
      await reload(terms.order);
      void refresh();
      onBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const left = order ? Math.max(0, Number(order.releaseAt) - now) : 0;
  const settled = order && [OrderState.Released, OrderState.Refunded, OrderState.Resolved].includes(order.state);
  const icon = { todo: '○', doing: '◌', done: '✓', failed: '✕' };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(20,19,15,0.45)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-label={`Buy ${item.name}`}
        initial={{ y: 30, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-auto p-7"
        style={{ maxWidth: 640, maxHeight: '92dvh', borderRadius: 26, background: '#fbf8ef', border: '1px solid #ded7c2', boxShadow: '0 50px 120px -40px rgba(0,0,0,0.5)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow" style={{ color: '#878371' }}>{item.merchant} · {usd(BigInt(item.price))} USDC</div>
            <h2 className="display mt-1 text-[2.3rem]">{item.name}</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost" aria-label="Close">Close</button>
        </div>

        {steps.length === 0 && (
          <div className="mt-5 grid gap-4">
            <p className="text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>{item.description}</p>
            {Object.keys(input).map((k) => (
              <label key={k} className="block">
                <span className="eyebrow" style={{ color: '#878371' }}>{k}</span>
                {k === 'text' ? (
                  <textarea className="field mt-1.5" rows={4} value={input[k]} onChange={(e) => setInput({ ...input, [k]: e.target.value })} />
                ) : (
                  <input className="field mt-1.5 mono text-[0.86rem]" value={input[k]} onChange={(e) => setInput({ ...input, [k]: e.target.value })} />
                )}
              </label>
            ))}
            <label className="flex items-center gap-3 text-[0.92rem]">
              <input type="checkbox" checked={extraHold} onChange={(e) => setExtraHold(e.target.checked)} style={{ accentColor: '#126b4a', width: 16, height: 16 }} />
              Ask for at least a 60-second hold, whatever the tiers say
            </label>
            <button className="btn btn-ink justify-center py-3.5" onClick={buy} disabled={busy}>
              Pay {usd(BigInt(item.price))} into escrow
            </button>
            <p className="mono text-[0.7rem]" style={{ color: '#878371' }}>
              Paying as {payer.kind === 'wallet' ? 'your connected wallet' : 'the built-in devnet test wallet'} <Addr a={payer.address} />. Devnet test funds only.
            </p>
          </div>
        )}

        {steps.length > 0 && (
          <ol className="mt-6 grid gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {steps.map((s, i) => (
              <motion.li key={s.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: s.state === 'todo' ? 0.4 : 1, x: 0 }} transition={{ duration: 0.4, ease: EASE, delay: i * 0.05 }} className="grid gap-3" style={{ gridTemplateColumns: '1.6rem 1fr' }}>
                <span className="mono grid h-6 w-6 place-items-center rounded-full text-[0.74rem]" style={{ background: s.state === 'done' ? '#126b4a' : s.state === 'failed' ? '#d03b3b' : '#ebe4d0', color: s.state === 'done' || s.state === 'failed' ? '#fff' : '#4b483e' }}>
                  {s.state === 'doing' ? <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block' }}>{icon.doing}</motion.span> : icon[s.state]}
                </span>
                <span>
                  <span className="text-[0.98rem] font-medium">{s.label}</span>
                  {s.detail && <span className="mt-0.5 block text-[0.84rem] leading-relaxed" style={{ color: '#4b483e' }}>{s.detail}</span>}
                </span>
              </motion.li>
            ))}
          </ol>
        )}

        {deliverable !== undefined && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="mt-5">
            <Deliverable value={deliverable} />
          </motion.div>
        )}

        {order && order.state === OrderState.Delivered && (
          <div className="mt-5 rounded-2xl p-5" style={{ background: '#f4efe0' }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="eyebrow" style={{ color: '#878371' }}>In escrow</div>
                <div className="display text-[2.4rem] leading-none">{left > 0 ? `${Math.ceil(left)} s` : 'hold over'}</div>
                <div className="mt-1 text-[0.84rem]" style={{ color: '#4b483e' }}>{left > 0 ? 'The merchant cannot take the money yet. You can dispute until the hold ends.' : 'Anyone can release it now; the merchant server will within a few seconds.'}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ink" disabled={busy} onClick={() => act('release')}>Release now</button>
                <button className="btn btn-ghost" disabled={busy || left <= 0} onClick={() => act('dispute')}>Dispute</button>
              </div>
            </div>
            <div className="mt-4" style={{ height: 4, borderRadius: 4, background: '#ded7c2', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#126b4a', width: `${order.releaseAt > order.deliveredAt ? (1 - left / Number(order.releaseAt - order.deliveredAt)) * 100 : 100}%`, transition: 'width 0.5s linear' }} />
            </div>
          </div>
        )}
        {order && order.state === OrderState.Disputed && (
          <div className="mt-5 rounded-2xl p-5 text-[0.95rem]" style={{ background: '#fdecea', border: '1px solid #f3c4bf', color: '#7a1f1f' }}>
            Disputed. The money stays in escrow until the arbiter rules. The demo arbiter checks the delivery against the hash on-chain and usually answers within a minute.
          </div>
        )}

        {settled && order && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl p-5" style={{ background: '#e7f4ec', border: '1px solid #bfdccb' }}>
            <div className="text-[1rem] font-medium">
              {order.state === OrderState.Released
                ? order.instant
                  ? 'Settled instantly.'
                  : order.settledAt < order.releaseAt
                    ? 'Released early: you confirmed receipt.'
                    : `Settled after a ${duration(order.holdSecs)} hold.`
                : order.state === OrderState.Refunded
                  ? 'Refunded to you in full.'
                  : 'Dispute resolved.'}
            </div>
            <div className="mono mt-1 text-[0.78rem]" style={{ color: '#4b483e' }}>
              merchant received {usd(order.paidMerchant, 4)} · protocol fee {usd(order.paidFee, 4)} · returned to you {usd(order.refunded, 4)}
            </div>
            {!reviewed && !order.buyerReviewed ? (
              <div className="mt-4 grid gap-3">
                <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} style={{ fontSize: 26, lineHeight: 1, cursor: 'pointer', color: n <= rating ? '#14130f' : '#c9c2ac' }} aria-label={`${n} stars`}>★</button>
                  ))}
                </div>
                <textarea className="field" rows={2} maxLength={200} placeholder="Say what happened (stored on-chain, up to 200 characters)" value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn btn-ink justify-center" disabled={busy} onClick={() => act('review')}>Post review on-chain</button>
              </div>
            ) : (
              <div className="mt-3 text-[0.9rem]">Your review is on-chain. <a className="link" href={`#/agents/${order.merchant}`}>See it on the merchant's credit file →</a></div>
            )}
          </motion.div>
        )}

        {error && <div className="mono mt-4 rounded-xl p-3 text-[0.78rem]" style={{ background: '#fdecea', color: '#7a1f1f', wordBreak: 'break-word' }}>{error}</div>}
      </motion.div>
    </motion.div>
  );
}

export function Market() {
  const [catalog, setCatalog] = useState<Item[] | null>(null);
  const [down, setDown] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [faucet, setFaucet] = useState<string | null>(null);
  const payer = usePayer();
  const { balances, reload } = useBalances(payer?.address);
  const { byWallet, params } = useProfiles();
  const { pairs } = useChain();

  useEffect(() => {
    api<Item[]>('/api/catalog').then(setCatalog).catch(() => setDown(true));
  }, []);

  const drip = async () => {
    if (!payer) return;
    setFaucet('Sending test funds…');
    try {
      const out = await api<{ sol: string; usdc: string }>('/api/faucet', { wallet: payer.address });
      setFaucet(`Sent ${out.usdc} test USDC and ${out.sol} SOL.`);
      setTimeout(reload, 1500);
    } catch (e) {
      setFaucet((e as Error).message);
    }
  };

  const me = payer ? byWallet.get(payer.address) : undefined;
  const holdWith = (merchantWallet: string): number | null => {
    const m = byWallet.get(merchantWallet);
    if (!params || !m) return null;
    const pair = payer ? pairs.find((p) => p.data.buyer === payer.address && p.data.merchant === merchantWallet) : undefined;
    const trusted = !!pair && pair.data.orders >= params.pairHistoryMin && pair.data.disputes === 0 && Date.now() / 1000 - Number(pair.data.firstSettledAt) >= params.pairAgeSecs && (me?.agent.penaltyBps ?? 0) === 0;
    return score.holdFor(params, m.eval.tier, me?.eval.tier ?? 0, trusted);
  };

  return (
    <div>
      <Nav />
      <main className="wrap pb-24 pt-12">
        <Reveal>
          <div className="eyebrow" style={{ color: '#878371' }}>Market · devnet</div>
          <h1 className="display mt-3 text-[clamp(2.6rem,6vw,5rem)]">
            Buy from an agent. <em>Watch the escrow work.</em>
          </h1>
          <p className="mt-5 max-w-[44rem] text-[1.05rem] leading-relaxed" style={{ color: '#4b483e' }}>
            These are the same merchant agents the buyer agents trade with over A2A and x402. Here you pay from a wallet instead: your browser checks the escrow on-chain, pays into it, checks what comes back against the hash the merchant committed, and then you rate the merchant.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="card mt-8 flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="eyebrow" style={{ color: '#878371' }}>{payer?.kind === 'wallet' ? 'Paying with your wallet' : 'Paying with the built-in devnet test wallet'}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                {payer ? <Addr a={payer.address} n={6} className="text-[0.95rem]" /> : <span className="mono">…</span>}
                <span className="mono text-[0.84rem]">{balances ? `${usd(balances.usdc)} USDC · ${(Number(balances.sol) / 1e9).toFixed(3)} SOL` : 'reading balances…'}</span>
                {me && <TierBadge tier={me.eval.tier} />}
                {me && <span className="mono text-[0.78rem]" style={{ color: '#878371' }}>score {me.eval.score}</span>}
              </div>
              {payer?.kind === 'burner' && <div className="mt-1.5 text-[0.8rem]" style={{ color: '#878371' }}>A throwaway key kept in this browser, for trying the flow. Connect a real wallet (set to devnet) to use your own.</div>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {faucet && <span className="mono text-[0.76rem]" style={{ color: '#4b483e' }}>{faucet}</span>}
              <button className="btn btn-ghost" onClick={drip} disabled={!payer || down}>Get test funds</button>
            </div>
          </div>
        </Reveal>

        {down && (
          <div className="card mt-6 p-7">
            <div className="text-[1.05rem] font-medium">The merchant agents are not reachable at {AGENTS_URL}.</div>
            <p className="mt-2 text-[0.95rem]" style={{ color: '#4b483e' }}>The rest of the site reads the chain directly and works without them. To buy something, start them:</p>
            <pre className="mono mt-3 rounded-xl p-4 text-[0.84rem]" style={{ background: '#14130f', color: '#e9e6d8' }}>npm run agents</pre>
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {(catalog ?? []).map((it, i) => {
            const m = byWallet.get(it.merchantWallet);
            const hold = holdWith(it.merchantWallet);
            return (
              <Reveal key={`${it.merchant}/${it.sku}`} delay={i * 0.06}>
                <motion.div whileHover={{ y: -5 }} transition={{ duration: 0.35, ease: EASE }} className="card flex h-full flex-col p-6">
                  <div className="flex items-center justify-between gap-3">
                    <a href={`#/agents/${it.merchantWallet}`} className="link text-[0.9rem] font-medium">{it.title.split(':')[0]}</a>
                    {m && <span className="flex items-center gap-3"><TierBadge tier={m.eval.tier} /><span className="mono text-[0.78rem]" style={{ color: '#878371' }}>{m.eval.score}</span></span>}
                  </div>
                  <div className="display mt-4 text-[2rem] leading-tight">{it.name}</div>
                  <p className="mt-2 text-[0.95rem] leading-relaxed" style={{ color: '#4b483e' }}>{it.description}</p>
                  <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                    <div>
                      <div className="display text-[2rem] leading-none">{usd(BigInt(it.price))}</div>
                      <div className="mono mt-1.5 text-[0.72rem]" style={{ color: '#878371' }}>
                        {hold === null ? 'USDC' : hold === 0 ? 'USDC · settles instantly for you' : `USDC · held ${duration(hold)} for you`}
                      </div>
                    </div>
                    <button className="btn btn-ink" onClick={() => setOpen(it)} disabled={!payer}>Buy</button>
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
        {params && (
          <p className="mono mt-6 text-[0.72rem] leading-relaxed" style={{ color: '#878371' }}>
            Your hold is the longer of the merchant's tier and yours ({tierName(me?.eval.tier ?? 0)}: {duration(params.holdSecs[me?.eval.tier ?? 0]!)}). After {params.pairHistoryMin} undisputed purchases from one merchant, only the merchant's tier counts.
          </p>
        )}
      </main>
      <Footer />
      <AnimatePresence>{open && payer && <Checkout key={open.sku} item={open} payer={payer} onClose={() => setOpen(null)} onBalance={reload} />}</AnimatePresence>
    </div>
  );
}
