import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  isAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { fetchMaybeOrder, getSubmitReviewInstructionAsync, OrderState, pairPdaOf, toHex, type Order } from '@tessera/sdk';
import { getWallets } from '@wallet-standard/app';
import { Footer } from './Landing';
import { clip200 } from './Market';
import { Nav } from '../components/Nav';
import { EASE, Reveal } from '../components/ui';
import { loadBurner, sendSigned, sendWith } from '../lib/burner';
import { readRpc } from '../lib/client';
import { ago, duration, explorerAddress, explorerTx, short, usd } from '../lib/format';
import { go, Link } from '../lib/router';
import { refresh, useChain } from '../lib/store';

// ------------------------------------------------------------ wallet standard

type StdWallet = ReturnType<ReturnType<typeof getWallets>['get']>[number];
type StdAccount = StdWallet['accounts'][number];
type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StdAccount[] }> };
type SignTxFeature = {
  supportedTransactionVersions?: readonly (number | 'legacy')[];
  signTransaction: (...inputs: { account: StdAccount; transaction: Uint8Array; chain?: string }[]) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};

const CHAIN = 'solana:devnet';

/** A wallet this page can use: it connects, signs a Solana transaction, and speaks a Solana chain. */
const usable = (w: StdWallet) => 'standard:connect' in w.features && 'solana:signTransaction' in w.features && w.chains.some((c) => c.startsWith('solana:'));

function useWallets(): StdWallet[] {
  const [list, setList] = useState<StdWallet[]>([]);
  useEffect(() => {
    const api = getWallets();
    const update = () => setList(api.get().filter(usable));
    update();
    const offRegister = api.on('register', update);
    const offUnregister = api.on('unregister', update);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  return list;
}

type Signer = { kind: 'wallet'; address: Address; wallet: StdWallet; account: StdAccount } | { kind: 'burner'; address: Address; signer: KeyPairSigner };

// ------------------------------------------------------------------- helpers

/** Every string inside an error, so a program error name or code can be matched. */
function errText(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (v == null || depth > 8) return;
    if (typeof v !== 'object') return void parts.push(String(v));
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (v instanceof Error) {
      parts.push(v.name, v.message);
      walk(v.cause, depth + 1);
    }
    for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
  };
  walk(e, 0);
  return parts.join(' | ');
}

/** A failed review in plain words. Program errors are matched by name, hex or decimal code. */
function explain(e: unknown): string {
  const t = errText(e);
  if (/already in use|AlreadyReviewed|0x177f|\b6015\b/i.test(t)) return 'This side has already reviewed this order. Each side can review an order once.';
  if (/ReviewWindowClosed|0x177e|\b6014\b/.test(t)) return 'The review window for this order has closed.';
  if (/NotAParty|0x1778|\b6008\b/.test(t)) return 'This wallet is not the buyer or the merchant of this order, so the program refused the review.';
  if (/InvalidRating|0x1780|\b6016\b/.test(t)) return 'The rating must be between 1 and 5 stars.';
  if (/InvalidState|0x1772|\b6002\b/.test(t)) return 'The order has not settled, so it cannot be reviewed yet.';
  if (/TextTooLong/.test(t)) return 'The review text is longer than 200 bytes.';
  if (/AccountNotInitialized|\b3012\b/.test(t)) return 'This wallet has no credit file on-chain yet, so it cannot review.';
  if (/reject|denied|declin|cancel|\b4001\b/i.test(t)) return 'You cancelled the request in your wallet. Nothing was sent.';
  if (/insufficient|no record of a prior credit|0x1\b/i.test(t)) return 'The wallet does not have enough devnet SOL to pay the fee and the small rent for the review account.';
  return `The review was not posted: ${(e as Error)?.message ?? String(e)}`;
}

const STATE_NAME: Record<number, string> = {
  [OrderState.AwaitingPayment]: 'Awaiting payment',
  [OrderState.Funded]: 'Funded, not delivered',
  [OrderState.Delivered]: 'Delivered, in escrow',
  [OrderState.Released]: 'Released to the merchant',
  [OrderState.Refunded]: 'Refunded to the buyer',
  [OrderState.Disputed]: 'Disputed, waiting for the arbiter',
  [OrderState.Resolved]: 'Dispute resolved',
  [OrderState.Cancelled]: 'Cancelled, never paid',
};

const SETTLED = [OrderState.Released, OrderState.Refunded, OrderState.Resolved];

function left(secs: number): string {
  if (secs <= 0) return 'closed';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ${String(Math.floor(secs % 60)).padStart(2, '0')} s`;
  return duration(Math.floor(secs));
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      className="mono grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.66rem]"
      style={{ background: on ? '#126b4a' : '#ebe4d0', color: on ? '#fff' : '#878371' }}
      title={on ? 'Read from the order account on-chain' : 'Not verified'}
      aria-label={on ? 'verified on-chain' : 'not verified'}
    >
      {on ? '✓' : '·'}
    </span>
  );
}

function Row({ label, children, verified = true }: { label: string; children: ReactNode; verified?: boolean }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4" style={{ borderTop: '1px solid #ebe4d0' }}>
      <div className="eyebrow pt-0.5" style={{ color: '#878371' }}>{label}</div>
      <div className="flex min-w-0 items-start gap-2.5">
        <Check on={verified} />
        <div className="min-w-0 text-[0.94rem]" style={{ overflowWrap: 'anywhere' }}>{children}</div>
      </div>
    </div>
  );
}

const Wallet = ({ w }: { w: string }) => (
  <a className="mono link" href={`#/agents/${w}`} title={w}>
    {short(w, 6)}
  </a>
);

// ---------------------------------------------------------------------- page

type Loaded = { status: 'idle' } | { status: 'loading' } | { status: 'invalid' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ok'; order: Order };

export function Review({ order: param }: { order?: string }) {
  const { config } = useChain();
  const [input, setInput] = useState(param ?? '');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'idle' });
  const [now, setNow] = useState(Date.now() / 1000);
  const wallets = useWallets();
  const [burner, setBurner] = useState<KeyPairSigner | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ signature: string; subject: string } | null>(null);

  useEffect(() => setInput(param ?? ''), [param]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void loadBurner().then(setBurner).catch(() => null);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!param) return setLoaded({ status: 'idle' });
    if (!isAddress(param)) return setLoaded({ status: 'invalid' });
    if (!quiet) setLoaded({ status: 'loading' });
    try {
      const o = await fetchMaybeOrder(readRpc, address(param));
      setLoaded(o.exists ? { status: 'ok', order: o.data } : { status: 'missing' });
    } catch (e) {
      // A Tessera order decodes; anything else at this address does not.
      const msg = (e as Error).message;
      setLoaded(/decode|discriminator|Expected|size/i.test(msg) ? { status: 'missing' } : { status: 'error', message: msg });
    }
  }, [param]);

  useEffect(() => {
    setPosted(null);
    setError(null);
    void load();
  }, [load]);

  const order = loaded.status === 'ok' ? loaded.order : null;
  const reviewSecs = config ? config.params.reviewSecs : null;
  const settled = !!order && SETTLED.includes(order.state);
  const closesAt = order && reviewSecs !== null ? Number(order.settledAt) + reviewSecs : null;
  const remaining = closesAt !== null ? closesAt - now : null;
  const open = settled && remaining !== null && remaining > 0;
  const deliveryHex = order ? toHex(order.deliveryHash) : '';
  const delivered = order ? /[^0]/.test(deliveryHex) : false;

  const role = useMemo(() => {
    if (!order || !signer) return null;
    if (signer.address === order.merchant) return { side: 'merchant' as const, subject: order.buyer, done: order.merchantReviewed };
    if (signer.address === order.buyer) return { side: 'buyer' as const, subject: order.merchant, done: order.buyerReviewed };
    return { side: 'stranger' as const, subject: null, done: false };
  }, [order, signer]);

  const burnerIsParty = !!order && !!burner && (burner.address === order.buyer || burner.address === order.merchant);

  const connect = async (w: StdWallet) => {
    setError(null);
    setConnecting(w.name);
    try {
      const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect();
      const account = accounts[0] ?? w.accounts[0];
      if (!account) throw new Error('The wallet shared no account.');
      setSigner({ kind: 'wallet', address: address(account.address), wallet: w, account });
    } catch (e) {
      setError(/reject|denied|declin|cancel|4001/i.test(errText(e)) ? 'You cancelled the connection in your wallet.' : `Could not connect to ${w.name}: ${(e as Error).message}`);
    } finally {
      setConnecting(null);
    }
  };

  const submit = async () => {
    if (!order || !signer || !role || role.side === 'stranger' || !param) return;
    setBusy(true);
    setError(null);
    try {
      const orderAddr = address(param);
      const pair = await pairPdaOf(order.buyer, order.merchant);
      let signature: string;
      if (signer.kind === 'burner') {
        const ix = await getSubmitReviewInstructionAsync({ order: orderAddr, subject: role.subject, pair, reviewer: signer.signer, payer: signer.signer, rating, text });
        signature = await sendWith(signer.signer, [ix]);
      } else {
        // The page builds the transaction; only the wallet holds the key.
        const noop = createNoopSigner(signer.address);
        const ix = await getSubmitReviewInstructionAsync({ order: orderAddr, subject: role.subject, pair, reviewer: noop, payer: noop, rating, text });
        const feature = signer.wallet.features['solana:signTransaction'] as SignTxFeature;
        const version = !feature.supportedTransactionVersions || feature.supportedTransactionVersions.includes(0) ? 0 : 'legacy';
        const { value: latest } = await readRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
        const message = pipe(
          createTransactionMessage({ version }),
          (m) => setTransactionMessageFeePayerSigner(noop, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
          (m) => appendTransactionMessageInstructions([ix], m),
        );
        const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
        const [out] = await feature.signTransaction({ account: signer.account, transaction: bytes, chain: CHAIN });
        if (!out) throw new Error('The wallet returned no signed transaction.');
        const signed = getTransactionDecoder().decode(out.signedTransaction);
        signature = await sendSigned(getBase64EncodedWireTransaction(signed), getSignatureFromTransaction(signed));
      }
      setPosted({ signature, subject: role.subject });
      setText('');
      await load(true);
      void refresh();
    } catch (e) {
      setError(explain(e));
      await load(true).catch(() => null);
    } finally {
      setBusy(false);
    }
  };

  const onLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    if (v) go(`/review/${v}`);
  };

  const cmd = `npm run tessera -- report ${param && isAddress(param) ? param : '<order>'} --outcome satisfied --rating ${rating} --comment "${text.replace(/"/g, '\\"') || '…'}" --keypair PATH --send`;

  return (
    <div>
      <Nav />
      <main className="wrap pb-24 pt-12">
        <Reveal>
          <div className="eyebrow" style={{ color: '#878371' }}>Review with a receipt · devnet</div>
          <h1 className="display mt-3 text-[clamp(2.6rem,6vw,5rem)]">
            No purchase, no review. <em>The receipt is on-chain.</em>
          </h1>
          <p className="mt-5 max-w-[44rem] text-[1.05rem] leading-relaxed" style={{ color: '#4b483e' }}>
            A review here needs two things. A receipt: the settled order account, which records the buyer, the merchant, the amount, when it settled and the hash of what was delivered. And a signature: the wallet that made the trade signs the review, and the program checks it is that order's buyer or merchant. Anyone else is refused, and each side can review an order once.
          </p>
        </Reveal>

        <form onSubmit={onLookup} className="card mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="eyebrow" style={{ color: '#878371' }}>Order address</span>
            <input className="field mono mt-1.5 text-[0.86rem]" value={input} onChange={(e) => setInput(e.target.value)} placeholder="The order account, for example from your checkout or a credit file" spellCheck={false} autoComplete="off" />
          </label>
          <button type="submit" className="btn btn-ink justify-center py-3.5">Check the receipt</button>
        </form>

        {loaded.status === 'idle' && (
          <p className="mt-5 text-[0.95rem]" style={{ color: '#4b483e' }}>
            Paste the address of an order you bought or sold. Orders are listed on the <Link to="/network" className="link">live network</Link> page and on each <Link to="/agents" className="link">credit file</Link>.
          </p>
        )}
        {loaded.status === 'loading' && <p className="mono mt-5 text-[0.84rem]" style={{ color: '#878371' }}>Reading the order from devnet…</p>}
        {loaded.status === 'invalid' && <Notice tone="bad">That is not a Solana address. Check it and try again.</Notice>}
        {loaded.status === 'missing' && (
          <Notice tone="bad">No Tessera order at this address on devnet. It may be a different kind of account, or the order was closed after settlement and its rent returned.</Notice>
        )}
        {loaded.status === 'error' && <Notice tone="bad">Could not read devnet just now: {loaded.message}</Notice>}

        {order && param && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="card p-6" aria-label="Verified receipt">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="display text-[2rem]">Verified receipt</h2>
                <span className="mono text-[0.72rem]" style={{ color: '#878371' }}>read from the order account on devnet</span>
              </div>
              <div className="mt-4">
                <Row label="Order">
                  <a className="mono link" href={explorerAddress(param)} target="_blank" rel="noreferrer" title="Opens Solana Explorer">{short(param, 8)}</a>
                </Row>
                <Row label="Buyer"><Wallet w={order.buyer} /></Row>
                <Row label="Merchant"><Wallet w={order.merchant} /></Row>
                <Row label="Amount">
                  <span className="mono">{usd(order.amount)} USDC</span>
                  {settled && (
                    <span className="mono block text-[0.76rem]" style={{ color: '#878371' }}>
                      to the merchant {usd(order.paidMerchant, 4)} · fee {usd(order.paidFee, 4)} · back to the buyer {usd(order.refunded, 4)}
                    </span>
                  )}
                </Row>
                <Row label="State">{STATE_NAME[order.state] ?? 'Unknown'}</Row>
                <Row label="Settled" verified={settled}>
                  {settled ? (
                    <span>
                      {new Date(Number(order.settledAt) * 1000).toLocaleString('en-GB')} <span style={{ color: '#878371' }}>({ago(Number(order.settledAt), now)})</span>
                    </span>
                  ) : (
                    <span style={{ color: '#878371' }}>Not settled yet</span>
                  )}
                </Row>
                <Row label="Delivery hash" verified={delivered}>
                  {delivered ? (
                    <span className="mono" title={deliveryHex}>{deliveryHex.slice(0, 16)}…{deliveryHex.slice(-8)}</span>
                  ) : (
                    <span style={{ color: '#878371' }}>No delivery was committed</span>
                  )}
                  {delivered && <span className="block text-[0.78rem]" style={{ color: '#878371' }}>sha256 of the delivery, committed by the merchant</span>}
                </Row>
                <Row label="Review window" verified={settled && reviewSecs !== null}>
                  {!settled ? (
                    <span style={{ color: '#878371' }}>Opens when the order settles</span>
                  ) : remaining === null ? (
                    <span style={{ color: '#878371' }}>Reading the config…</span>
                  ) : open ? (
                    <span><span className="mono">{left(remaining)}</span> left</span>
                  ) : (
                    <span>Closed {ago(closesAt!, now)}</span>
                  )}
                </Row>
                <Row label="Reviews">
                  <span>Buyer {order.buyerReviewed ? 'has reviewed' : 'has not reviewed'} · Merchant {order.merchantReviewed ? 'has reviewed' : 'has not reviewed'}</span>
                </Row>
              </div>
              {!settled && <Notice tone="warn">This order has not settled yet. Reviews open once it settles: released, refunded or resolved after a dispute.</Notice>}
              {settled && remaining !== null && !open && <Notice tone="warn">The review window for this order has closed. The program accepts reviews only within {duration(reviewSecs!)} of settlement.</Notice>}
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.08 }} className="card p-6" aria-label="Sign your review">
              <h2 className="display text-[2rem]">Sign your review</h2>
              <p className="mt-2 text-[0.95rem] leading-relaxed" style={{ color: '#4b483e' }}>Sign your review with the wallet that made this trade.</p>

              {!signer && (
                <div className="mt-4 grid gap-2">
                  {wallets.map((w) => (
                    <button key={w.name} className="btn btn-ghost justify-start py-3" onClick={() => void connect(w)} disabled={!!connecting}>
                      {w.icon && <img src={w.icon} alt="" width={20} height={20} style={{ borderRadius: 5 }} />}
                      {connecting === w.name ? `Connecting to ${w.name}…` : `Connect ${w.name}`}
                    </button>
                  ))}
                  {wallets.length === 0 && (
                    <p className="text-[0.88rem]" style={{ color: '#878371' }}>
                      No browser wallet found. A Solana wallet extension that supports Wallet Standard and devnet will show up here.
                    </p>
                  )}
                  {burnerIsParty && burner && (
                    <button className="btn btn-ghost justify-start py-3" onClick={() => setSigner({ kind: 'burner', address: burner.address, signer: burner })}>
                      Use this browser's devnet test wallet ({short(burner.address, 4)})
                    </button>
                  )}
                </div>
              )}

              {signer && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5" style={{ background: '#f4efe0' }}>
                  <span className="text-[0.88rem]">
                    {signer.kind === 'wallet' ? signer.wallet.name : 'Devnet test wallet'} · <span className="mono">{short(signer.address, 6)}</span>
                  </span>
                  <button className="link text-[0.84rem]" style={{ cursor: 'pointer' }} onClick={() => { setSigner(null); setError(null); }}>
                    Change wallet
                  </button>
                </div>
              )}

              {signer && role?.side === 'stranger' && (
                <Notice tone="bad">Only the buyer or the merchant of this order can review it. This wallet is neither, so the program would refuse it.</Notice>
              )}

              {signer && role && role.side !== 'stranger' && (
                <div className="mt-4">
                  <div className="text-[1rem] font-medium">
                    {role.side === 'merchant' ? 'You sold to this buyer: rate the buyer' : 'You bought from this merchant: rate the merchant'}
                  </div>
                  <div className="mono mt-0.5 text-[0.78rem]" style={{ color: '#878371' }}>
                    reviewing <Wallet w={role.subject} />
                  </div>

                  {posted ? (
                    <div className="mt-4 rounded-2xl p-4 text-[0.92rem]" style={{ background: '#e7f4ec', border: '1px solid #bfdccb' }}>
                      Your review is on-chain.{' '}
                      <a className="mono link" href={explorerTx(posted.signature)} target="_blank" rel="noreferrer">{short(posted.signature, 8)}</a>
                      <div className="mt-1.5">
                        <a className="link" href={`#/agents/${posted.subject}`}>See it on the credit file →</a>
                      </div>
                    </div>
                  ) : role.done ? (
                    <Notice tone="ok">
                      You have already reviewed this order as the {role.side}. <a className="link" href={`#/agents/${role.subject}`}>See it on the credit file →</a>
                    </Notice>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} style={{ fontSize: 28, lineHeight: 1, cursor: 'pointer', color: n <= rating ? '#14130f' : '#c9c2ac' }} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
                            ★
                          </button>
                        ))}
                        <span className="mono ml-2 text-[0.78rem]" style={{ color: '#878371' }}>{rating} of 5</span>
                      </div>
                      <textarea
                        className="field"
                        rows={3}
                        maxLength={200}
                        aria-label="Review text"
                        placeholder="Say what happened (stored on-chain, up to 200 bytes)"
                        value={text}
                        onChange={(e) => setText(clip200(e.target.value))}
                      />
                      <div className="mono text-right text-[0.7rem]" style={{ color: '#878371' }}>{new TextEncoder().encode(text).length} / 200 bytes</div>
                      <button className="btn btn-ink justify-center py-3.5" disabled={busy || !open} onClick={() => void submit()}>
                        {busy ? 'Waiting for the wallet and devnet…' : 'Sign and post the review'}
                      </button>
                      {!open && <div className="text-[0.84rem]" style={{ color: '#878371' }}>{settled ? 'The review window has closed.' : 'Reviews open once the order settles.'}</div>}
                    </div>
                  )}
                </div>
              )}

              {error && <div className="mono mt-4 rounded-xl p-3 text-[0.8rem]" role="alert" style={{ background: '#fdecea', color: '#7a1f1f', wordBreak: 'break-word' }}>{error}</div>}
            </motion.section>
          </div>
        )}

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="card p-6">
            <div className="eyebrow" style={{ color: '#878371' }}>How a review counts</div>
            <ul className="mt-3 grid gap-2 text-[0.92rem] leading-relaxed" style={{ color: '#4b483e', paddingLeft: '1.1rem', listStyle: 'disc' }}>
              <li>On a released order, a merchant's review counts only after the buyer has reviewed the same order.</li>
              <li>A review of a refunded order weighs 0.</li>
              <li>
                Window: {reviewSecs !== null ? duration(reviewSecs) : '…'} after settlement, as set in the program's config.
              </li>
              <li>One review per side per order. The review account is derived from the order and the reviewer, so a second one cannot be created.</li>
              <li>The text is public and stays on-chain. The signing wallet pays the fee and a small rent for the review account, in devnet SOL.</li>
            </ul>
          </div>
          <div className="card p-6">
            <div className="eyebrow" style={{ color: '#878371' }}>The same from a terminal</div>
            <pre className="mono mt-3 overflow-x-auto rounded-xl p-4 text-[0.78rem] leading-relaxed" style={{ background: '#14130f', color: '#e9e6d8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{cmd}</pre>
            <p className="mt-2 text-[0.84rem]" style={{ color: '#878371' }}>Signs locally with your keypair file and sends through the Tessera API.</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const c = { ok: ['#e7f4ec', '#bfdccb', '#14130f'], warn: ['#fdf4e0', '#f0d9a6', '#5c4307'], bad: ['#fdecea', '#f3c4bf', '#7a1f1f'] }[tone];
  return (
    <div className="mt-4 rounded-2xl p-4 text-[0.92rem] leading-relaxed" style={{ background: c[0], border: `1px solid ${c[1]}`, color: c[2] }}>
      {children}
    </div>
  );
}
