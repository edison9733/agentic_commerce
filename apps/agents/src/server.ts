/**
 * The merchant side of the demo network, in one process:
 *
 *   /agents/:id/.well-known/agent-card.json   A2A agent card
 *   /agents/:id/a2a                           A2A JSON-RPC (message/send, tasks/get) + x402 extension
 *   /agents/:id/x402/:skill                   the same sale over plain HTTP 402
 *   /api/*                                    what the website's wallet checkout calls
 *
 * plus two background jobs any third party could run instead, because they
 * only use permissionless instructions: a crank that releases escrows whose
 * hold has ended, and (with the arbiter key) a bot that resolves disputes by
 * checking the delivery against the hash committed on-chain.
 *
 *   npm run agents
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIPv6 } from 'node:net';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { address, lamports } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { bytesEqual, fromUnits, TIER_NAMES, type Decoded, type Order } from '@tessera/sdk';
import { ADVERSARIES, keyPath, MERCHANTS } from '../../../scripts/cast.js';
import { chainNow, clientForSigner, forgetEnvKeys, loadKeypair, sleep, tokenHelpers } from '../../../scripts/lib.js';
import { agentCard, handleRpc } from './a2a.js';
import {
  closeOrder,
  findOrders,
  getConfig,
  OrderState,
  readOrder,
  refund,
  release,
  resolveDispute,
  send,
  submitReview,
  cancelUnpaid,
  type Actor,
} from './chain.js';
import { config } from './config.js';
import { facilitators } from './facilitator.js';
import { loadEvidence, MerchantAgent, pruneEvidence, type Behaviour } from './merchant.js';
import { hashOf } from './services.js';
import { dataDir, writeFileDurable } from './store.js';

// A rejected promise nobody awaited must not take the server down: log it and carry on.
process.on('unhandledRejection', (e) => console.error('[unhandled]', (e as Error)?.message ?? e));

const ops = clientForSigner(await loadKeypair('.keys/server.json'));
const arbiter = clientForSigner(await loadKeypair('.keys/arbiter.json'));

const merchants = new Map<string, MerchantAgent>();
for (const m of [...MERCHANTS, ...ADVERSARIES.filter((a) => a.role === 'merchant')]) {
  const behaviour: Behaviour = m.behaviour === 'no-show' ? 'no-show' : 'honest';
  merchants.set(m.id, new MerchantAgent(m.id, m.title, clientForSigner(await loadKeypair(keyPath(m.id))), ops, behaviour));
}
// Every key is loaded: the secrets in TESSERA_KEYS are not needed in memory any more.
forgetEnvKeys();

// The arbiter's evidence from earlier runs.
let restored = 0;
for (const e of loadEvidence()) {
  const m = merchants.get(e.merchant);
  if (m) {
    const list = m.deliveries.get(e.order) ?? [];
    list.push({ sku: e.sku, deliverable: e.deliverable, input: e.input, at: e.at, holdSecs: e.holdSecs });
    m.deliveries.set(e.order, list);
    restored += 1;
  }
}
const restoredQuotes = [...merchants.values()].reduce((n, m) => n + m.quotes.size, 0);

// ------------------------------------------------------- where state lives
/**
 * Quotes, results and the arbiter's evidence are files. On Railway the data
 * directory has to be a volume, or a redeploy deletes them: orders paid and
 * not yet answered, and disputes with nothing to judge them by. Until that is
 * fixed this server refuses orders (it still serves reads and cranks).
 */
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_ID);
let stateProblem: string | undefined;
try {
  writeFileDurable(`${dataDir()}/.probe`, 'ok');
} catch (e) {
  stateProblem = `the data directory ${dataDir()} cannot be written (${(e as Error).message})`;
}
if (!stateProblem && onRailway && process.env.RAILWAY_VOLUME_MOUNT_PATH !== dataDir()) {
  stateProblem = `no Railway volume is mounted at ${dataDir()}, so a redeploy would delete quotes and dispute evidence`;
}
if (stateProblem && config.allowEphemeralState) {
  console.warn(`[state] ${stateProblem}; TESSERA_ALLOW_EPHEMERAL_STATE=1, so orders are accepted anyway`);
  stateProblem = undefined;
}
if (stateProblem) console.error(`[state] ${stateProblem}. Refusing new orders until that is fixed.`);

// ------------------------------------------------------------ HTTP server
const app = express();
app.disable('x-powered-by');
// A number is a hop count (1 behind one proxy, as on Railway); anything else, addresses or names.
if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  console.warn('[http] RAILWAY_PUBLIC_DOMAIN is set but TRUST_PROXY is not: every client would share one rate limit. Set TRUST_PROXY=1.');
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  // orders, claims and deliveries are for one caller
  if (req.path.startsWith('/api/') || req.path.includes('/x402/') || req.path.endsWith('/a2a')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(cors({ origin: config.webOrigins, exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }));
app.use(express.json({ limit: '64kb' }));

/**
 * Who a request is from, for limits and caps: the address for IPv4, the /64
 * for IPv6 (one subscriber gets a whole /64, so each address in it would be
 * its own client), and an IPv4-mapped IPv6 address as the IPv4 it carries.
 */
export function clientKey(req: Request): string {
  const ip = (req.ip ?? '').split('%')[0]!.toLowerCase();
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = '', tail] = ip.split('::') as [string, string | undefined];
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = tail === undefined ? front : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/**
 * A fixed window of requests per client. Quotes open orders on-chain and the
 * faucet hands out funds, and both are paid for by this server, so a script
 * inventing wallet addresses must not be able to call them without end. The
 * table is bounded: when it is full the oldest clients are forgotten.
 */
const MAX_CLIENTS = 20_000;
function perClient(what: string, max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (hits.size >= MAX_CLIENTS) {
      for (const [k, h] of hits) if (h.until < now) hits.delete(k);
      // Still full of live entries: drop the oldest (a Map iterates in insertion order).
      for (const k of hits.keys()) {
        if (hits.size < MAX_CLIENTS * 0.9) break;
        hits.delete(k);
      }
    }
    const key = clientKey(req);
    const h = hits.get(key);
    if (!h || h.until < now) {
      hits.delete(key);
      hits.set(key, { n: 1, until: now + windowMs });
      return next();
    }
    if (h.n >= max) {
      res.setHeader('Retry-After', String(Math.ceil((h.until - now) / 1000)));
      return void res.status(429).json({ error: `too many ${what} from this address; try again in ${Math.ceil((h.until - now) / 1000)} s` });
    }
    h.n += 1;
    next();
  };
}
const anyLimit = perClient('requests', config.requestsPerMinute, 60_000);
const quoteLimit = perClient('quotes', config.quotesPerMinute, 60_000);
// Collecting a delivery, and paying by x402, cost the chain reads and a facilitator call each.
const fulfilLimit = perClient('payment and delivery requests', 30, 60_000);
const faucetLimit = perClient('faucet requests', 3, 3_600_000);

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** An error message that is safe to show: short, one line. */
const publicMessage = (e: unknown) => String((e as Error)?.message ?? 'failed').replace(/\s+/g, ' ').slice(0, 300);

/** One answer shared by everyone who asks within `ttlMs`; a failed one is not kept. */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (!hit || Date.now() - hit.at > ttlMs) {
      const value = load();
      const mine = { at: Date.now(), value };
      hit = mine;
      value.catch(() => {
        if (hit === mine) hit = undefined;
      });
    }
    return hit.value;
  };
}

const merchantOf = (req: Request, res: Response): MerchantAgent | null => {
  const m = merchants.get(String(req.params.id));
  if (!m) res.status(404).json({ error: 'unknown agent' });
  return m ?? null;
};

// Up until the first config read has worked, and while draining for a restart.
let ready = false;
let draining = false;

// For a host's health check: answers at once, with no network calls.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(anyLimit);

app.get('/health', async (_req, res) => {
  if (!ready || draining) return void res.status(503).json({ ok: false, status: draining ? 'draining' : 'starting' });
  res.json({ ok: true, network: config.network, facilitators: (await facilitators()).map((f) => f.url), ...(stateProblem ? { warning: stateProblem } : {}) });
});

// Nothing below works before the chain can be read, or while the process is going away.
app.use((_req, res, next) => {
  if (!ready || draining) return void res.status(503).json({ error: draining ? 'restarting' : 'starting up; try again in a moment' });
  next();
});

/** Routes that open orders or take payment. */
const taking = (_req: Request, res: Response, next: NextFunction) => {
  if (stateProblem) return void res.status(503).json({ error: 'this server cannot keep orders safely right now; try again later' });
  next();
};

// Both are read from the chain, so everyone shares one answer for a few seconds.
const agentList = cached(15_000, async () =>
  Promise.all(
    [...merchants.values()].map(async (m) => ({
      id: m.id,
      wallet: m.wallet,
      title: m.title,
      card: `${config.publicUrl}/agents/${m.id}/.well-known/agent-card.json`,
      standing: await m.standing(),
      skills: m.services.map((s) => ({ id: s.sku, name: s.name, description: s.description, price: s.price.toString(), example: s.example })),
    })),
  ),
);
app.get('/agents', async (_req, res) => {
  res.json(await agentList());
});

// ------------------------------------------------------------------ A2A
const cards = new Map<string, () => Promise<unknown>>();
app.get('/agents/:id/.well-known/agent-card.json', async (req, res) => {
  const m = merchantOf(req, res);
  if (!m) return;
  let card = cards.get(m.id);
  if (!card) cards.set(m.id, (card = cached(15_000, () => agentCard(m))));
  res.json(await card());
});

app.post('/agents/:id/a2a', (req, res, next) => (req.body?.params?.message?.taskId ? fulfilLimit : quoteLimit)(req, res, next), taking, async (req, res) => {
  const m = merchantOf(req, res);
  if (!m) return;
  const id = req.body?.id ?? null;
  try {
    const out = await handleRpc(m, req.body ?? {}, req.header('X-A2A-Extensions'), clientKey(req));
    if ('result' in out) res.setHeader('X-A2A-Extensions', req.header('X-A2A-Extensions') ?? '');
    res.json({ jsonrpc: '2.0', id, ...out });
  } catch (e) {
    console.error('[a2a]', publicMessage(e));
    res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
  }
});

// ------------------------------------------------------- plain HTTP 402
app.get('/agents/:id/x402/:skill', (req, res, next) => (req.header('PAYMENT-SIGNATURE') ? fulfilLimit : quoteLimit)(req, res, next), taking, async (req, res) => {
  const m = merchantOf(req, res);
  if (!m) return;
  const header = req.header('PAYMENT-SIGNATURE');
  try {
    if (!header) {
      const buyer = String(req.query.buyer ?? '');
      if (!buyer) return void res.status(400).json({ error: 'add ?buyer=<wallet> so an escrow can be opened for you' });
      const input = req.query.input ? JSON.parse(String(req.query.input)) : {};
      const quote = await m.quote({
        buyer,
        sku: String(req.params.skill),
        input,
        resourceUrl: `${config.publicUrl}${req.originalUrl}`,
        client: clientKey(req),
      });
      res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(quote.required));
      return void res.status(402).json(quote.required);
    }
    const payload = decodePaymentSignatureHeader(header);
    const f = await m.fulfil(payload.accepted.payTo, payload, clientKey(req));
    if (f.receipts[0]) res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(f.receipts[0]));
    res.json({ result: f.deliverable, escrow: { order: f.order, deliveryHash: f.deliveryHash, state: f.state, instant: f.instant, releaseAt: f.releaseAt } });
  } catch (e) {
    // Once money has moved, never invite the client to pay again.
    const paid = Boolean(header);
    res.status(paid ? 502 : 400).json({
      error: publicMessage(e),
      ...(paid ? { note: 'Do not pay again. If the escrow was funded, the merchant refunds it before the delivery deadline.' } : {}),
    });
  }
});

// ------------------------------------------------- website wallet checkout
const catalog = [...merchants.values()]
  .filter((m) => m.behaviour === 'honest' && m.id !== 'washer')
  .flatMap((m) =>
    m.services.map((s) => ({
      merchant: m.id,
      merchantWallet: m.wallet,
      title: m.title,
      sku: s.sku,
      name: s.name,
      description: s.description,
      price: s.price.toString(),
      example: s.example,
    })),
  );
app.get('/api/catalog', (_req, res) => {
  res.json(catalog);
});

app.post('/api/orders', quoteLimit, taking, async (req, res) => {
  try {
    const m = merchants.get(String(req.body?.merchant));
    if (!m) return void res.status(404).json({ error: 'unknown merchant' });
    const quote = await m.quote({
      buyer: String(address(String(req.body?.buyer))),
      sku: String(req.body?.sku),
      input: req.body?.input ?? {},
      minHoldSecs: Number(req.body?.minHoldSecs ?? 0) || undefined,
      resourceUrl: `${config.publicUrl}/api/orders`,
      client: clientKey(req),
    });
    const claim = randomBytes(18).toString('base64url');
    m.setClaim(quote.terms.order, claim);
    res.json({ terms: quote.terms, required: quote.required, claim });
  } catch (e) {
    res.status(400).json({ error: publicMessage(e) });
  }
});

/**
 * Called after the buyer's wallet has funded the vault. The program decides
 * whether it did. The order address is public, so the caller also shows the
 * claim that only the quote's requester was given. Asked again for an order
 * already delivered (a lost response), it returns the same delivery.
 */
app.post('/api/orders/:order/fulfil', fulfilLimit, async (req, res) => {
  const order = String(req.params.order);
  const m = [...merchants.values()].find((x) => x.claimOf(order));
  const claim = m?.claimOf(order);
  if (!m || !claim) return void res.status(404).json({ error: 'unknown or expired order' });
  if (!sameSecret(String(req.body?.claim ?? ''), claim)) return void res.status(403).json({ error: 'this order was quoted to someone else' });
  try {
    const f = await m.fulfil(order, undefined, clientKey(req));
    res.json(f);
  } catch (e) {
    res.status(400).json({ error: publicMessage(e) });
  }
});

// ------------------------------------------------------------ demo faucet
// Devnet only: a little SOL and test USDC so a visitor (or the site's
// built-in test wallet) can try a purchase without hunting for a faucet.
const DRIP_USDC = 800_000n;
const dripped = new Set<string>();
const dripping = new Set<string>();
/** When each drip in the last hour was handed out, or has been promised: a slot is taken before the first await. */
const drips: number[] = [];

/**
 * The faucet hands out test USDC, and visitors spend it at the merchants this
 * server runs. So when the faucet runs low, the richest honest merchant's
 * takings go back into it and the demo keeps itself going. Devnet only: on a
 * real deployment a merchant's revenue is its own.
 */
async function refillFaucet(tok: ReturnType<typeof tokenHelpers>): Promise<void> {
  if ((await tok.balance(ops.identity.address)) >= DRIP_USDC) return;
  let best: { m: MerchantAgent; have: bigint } | undefined;
  for (const m of merchants.values()) {
    if (m.behaviour !== 'honest') continue;
    const have = await tok.balance(m.wallet).catch(() => 0n);
    if (!best || have > best.have) best = { m, have };
  }
  const spare = best ? best.have - 200_000n : 0n;
  if (!best || spare < DRIP_USDC) {
    throw new Error('the demo faucet is out of test USDC. Get some for Solana devnet at faucet.circle.com, or run npm run swarm so the agents trade again');
  }
  const amount = spare < 4_000_000n ? spare : 4_000_000n;
  await send(best.m.signer, [await tok.transferIx(best.m.signer, await tok.ata(ops.identity.address), amount)]);
  console.log(`[faucet] refilled with ${fromUnits(amount)} USDC from ${best.m.id}'s takings`);
}

app.post('/api/faucet', faucetLimit, taking, async (req, res) => {
  let to: ReturnType<typeof address> | undefined;
  let slot: number | undefined;
  try {
    to = address(String(req.body?.wallet));
    const hour = Date.now() - 3_600_000;
    while (drips.length && drips[0]! < hour) drips.shift();
    if (dripped.has(to) || dripping.has(to)) return void res.status(429).json({ error: 'this wallet was already funded' });
    if (drips.length >= 20) return void res.status(429).json({ error: 'the demo faucet is resting; try again in an hour or use faucet.circle.com' });
    // reserved now, so a burst of requests cannot all get past the cap while the first is still sending
    dripping.add(to);
    slot = Date.now();
    drips.push(slot);
    const cfg = await getConfig(ops);
    const tok = tokenHelpers(ops, cfg.mint);
    await refillFaucet(tok);
    const signature = await send(ops, [
      getTransferSolInstruction({ source: ops.identity, destination: to, amount: lamports(20_000_000n) }),
      await tok.ensureAtaIx(to),
      await tok.transferIx(ops, await tok.ata(to), DRIP_USDC),
    ]);
    // only a wallet that was actually funded is remembered, so a failed attempt can be retried
    dripped.add(to);
    slot = undefined;
    res.json({ sol: '0.02', usdc: fromUnits(DRIP_USDC), signature });
  } catch (e) {
    if (slot !== undefined) drips.splice(drips.indexOf(slot), 1);
    res.status(400).json({ error: publicMessage(e).slice(0, 200) });
  } finally {
    if (to) dripping.delete(to);
  }
});

// Anything that got past the routes: a body that does not parse, or a bug. Never a stack trace.
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});
app.use((err: { status?: number; message?: string }, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(`[http] ${req.method} ${req.path}: ${publicMessage(err)}`);
  if (res.headersSent) return void res.end();
  res.status(status).json({ error: status === 500 ? 'internal error' : 'bad request' });
});

// ---------------------------------------------------------------- the crank
const noShow: { merchant: MerchantAgent; order: string }[] = [];

/** Orders the crank keeps failing on are tried less and less often, so one cannot eat the RPC budget. */
const failures = new Map<string, { n: number; until: number }>();
function failed(order: string, what: string, e: unknown): void {
  const f = failures.get(order) ?? { n: 0, until: 0 };
  f.n += 1;
  f.until = Date.now() + Math.min(300_000, config.crankEveryMs * 2 ** f.n);
  failures.set(order, f);
  if (failures.size > 5000) failures.delete(failures.keys().next().value!);
  console.warn(`[crank] ${what} ${order.slice(0, 8)}: ${publicMessage(e).slice(0, 160)}`);
}
const backedOff = (order: string) => (failures.get(order)?.until ?? 0) > Date.now();

/** The orders we paid the rent for that are Funded or Disputed, looked up at most every 10 s. */
let scanned: { at: number; funded: Decoded<Order>[]; disputed: Decoded<Order>[] } | undefined;
async function scan(): Promise<NonNullable<typeof scanned>> {
  if (scanned && Date.now() - scanned.at < 10_000) return scanned;
  const [funded, disputed] = await Promise.all([
    findOrders(ops, { payer: ops.identity.address, state: OrderState.Funded }),
    findOrders(ops, { payer: ops.identity.address, state: OrderState.Disputed }),
  ]);
  scanned = { at: Date.now(), funded, disputed };
  return scanned;
}

const byWallet = new Map([...merchants.values()].map((m) => [m.wallet as string, m]));

async function crank(now: bigint): Promise<void> {
  const cfg = await getConfig(ops);
  const { funded, disputed } = await scan();

  // A dispute is judged as soon as it is seen, not when the hold would have ended.
  for (const { address: order, data: o } of disputed) {
    const m = byWallet.get(o.merchant);
    if (m && !m.pending.has(order)) m.pending.set(order, 0);
  }

  for (const m of merchants.values()) {
    // Unpaid quotes, funded orders nobody is delivering, and quotes that moved on.
    await m.tend(funded).catch((e) => console.warn(`[crank] ${m.id}: ${publicMessage(e).slice(0, 160)}`));

    for (const [order, due] of [...m.pending]) {
      if (now < BigInt(due) || backedOff(order)) continue;
      try {
        await tendPending(m, order, now, cfg.params.reviewSecs);
        failures.delete(order);
      } catch (e) {
        failed(order, `${m.id} order`, e);
      }
    }
  }

  // A merchant that took an order and went quiet: anyone may refund the buyer at the deadline.
  for (let i = noShow.length - 1; i >= 0; i -= 1) {
    const { merchant, order } = noShow[i]!;
    if (backedOff(order)) continue;
    try {
      const o = await readOrder(ops, address(order));
      if (!o || o.state !== OrderState.Funded) {
        noShow.splice(i, 1);
        continue;
      }
      if (now > o.deliverBy) {
        await refund(ops, address(order), o);
        console.log(`[crank] refunded ${order.slice(0, 8)}: ${merchant.id} never delivered`);
        noShow.splice(i, 1);
      }
    } catch (e) {
      failed(order, 'no-show refund', e);
    }
  }
}

/** One delivered, disputed or settled order of a merchant: release it, judge it, rate it. */
async function tendPending(m: MerchantAgent, order: string, now: bigint, reviewSecs: number): Promise<void> {
  let o = await readOrder(ops, address(order));
  if (o && o.state === OrderState.Delivered) {
    if (now < o.releaseAt) return;
    await release(ops, address(order), o);
    console.log(`[crank] released ${order.slice(0, 8)} to ${m.id} after a ${Number(o.releaseAt - o.deliveredAt)}s hold`);
    o = await readOrder(ops, address(order));
  }
  if (o && o.state === OrderState.Disputed) {
    if (o.arbiter !== arbiter.identity.address) {
      // Not ours to judge (the arbiter was changed): leave it to whoever it names, or to the program's fallback.
      console.warn(`[arbiter] ${order.slice(0, 8)} names another arbiter; not ruling on it`);
      m.pending.delete(order);
      return;
    }
    await arbitrate(m, order, o);
    o = await readOrder(ops, address(order));
  }
  // The program weighs a merchant's review of a released order only once
  // the buyer has reviewed it, so wait for that until the window closes.
  if (o && !o.merchantReviewed && o.state === OrderState.Released && !o.buyerReviewed) {
    // Look again in half a minute, not every tick: the RPC budget is shared.
    if (now <= o.settledAt + BigInt(reviewSecs)) m.pending.set(order, Number(now) + 30);
    else m.pending.delete(order);
    return;
  }
  if (o && !o.merchantReviewed && (o.state === OrderState.Released || o.state === OrderState.Resolved)) {
    const buyerLost = o.state === OrderState.Resolved && o.refunded === 0n;
    if (o.state === OrderState.Released || buyerLost) {
      await submitReview(m.signer, ops, address(order), o, buyerLost ? 1 : 5, buyerLost ? 'Disputed a delivery that matched its hash.' : 'Paid in full.').catch(
        (e) => console.warn(`[crank] review ${order.slice(0, 8)}: ${publicMessage(e).slice(0, 120)}`),
      );
    }
  }
  // What was kept for the arbiter and for a buyer's retry is dropped by the merchant once the dispute window is long over.
  if (!o || o.state !== OrderState.Delivered) m.pending.delete(order);
}

/**
 * The demo arbiter. It does one honest check: is what the merchant holds the
 * thing whose hash it committed on-chain, and is it a valid answer to what
 * was ordered? If so the dispute is unfounded. With no evidence on file it
 * cannot tell, so it splits the vault evenly, which penalises nobody: losing
 * the file must not hand every disputing buyer a win.
 */
async function arbitrate(m: MerchantAgent, order: string, o: Order): Promise<void> {
  const { any, match } = await m.evidenceFor(order, o.deliveryHash);
  if (!any) {
    await resolveDispute(arbiter, address(order), o, 5_000);
    console.log(`[arbiter] ${order.slice(0, 8)}: no record of what ${m.id} delivered; split evenly, nobody penalised`);
    return;
  }
  // What is on file must be the thing that was committed, for the thing that was ordered.
  const matches = Boolean(match);
  const asked = match?.input === undefined || bytesEqual(await hashOf({ sku: match.sku, input: match.input }), o.requestHash);
  const valid = Boolean(match) && m.service(match!.sku).valid(match!.deliverable, match!.input);
  const merchantBps = matches && asked && valid ? 10_000 : 0;
  await resolveDispute(arbiter, address(order), o, merchantBps);
  console.log(
    `[arbiter] ${order.slice(0, 8)}: delivery ${matches ? 'matches' : 'does not match'} the on-chain hash and is ${valid ? 'valid' : 'not valid'}; ` +
      `${merchantBps === 10_000 ? `merchant ${m.id}` : 'buyer'} wins` +
      (o.pairTrusted ? ' (buyer had prior undisputed purchases here)' : ''),
  );
}

/**
 * An instant order the buyer never rated keeps counting against the
 * merchant's instant limit until its review window ends and someone closes
 * it. `close_order` is permissionless, so this is one more public crank.
 * Orders that were held, or rated, are left in place as history.
 *
 * Only the instant orders this server knows of are looked at (the ones it
 * delivered, and the ones found when it started), not every order in the
 * program.
 */
const seasoning = new Set<string>();
async function season(): Promise<void> {
  for (const m of merchants.values()) for (const [order, d] of m.fulfilled) if (d.f.instant) seasoning.add(order);
  if (!seasoning.size) return;
  const cfg = await getConfig(ops);
  const now = await chainNow(ops);
  let freed = 0;
  for (const order of [...seasoning].slice(0, 50)) {
    if (backedOff(order)) continue;
    try {
      const o = await readOrder(ops, address(order));
      if (!o || o.state !== OrderState.Released || !o.instant || o.seasoned || o.complained) {
        seasoning.delete(order);
        continue;
      }
      if (now <= o.settledAt + BigInt(cfg.params.reviewSecs)) continue;
      await closeOrder(ops, address(order), o);
      seasoning.delete(order);
      freed += 1;
    } catch (e) {
      failed(order, 'close', e);
    }
  }
  if (freed) console.log(`[crank] closed ${freed} unrated instant order(s); their amounts no longer count against the merchants' limits`);
}

/**
 * Orders we paid the rent for that nobody is looking after: quotes left
 * unpaid whose in-memory record is gone (state lost, or opened by an earlier
 * run), whose rent and anything paid in comes back; and cancelled orders,
 * which the program keeps as tombstones (so the order id cannot be reused)
 * until the payment window has passed again, and are then closed for their rent. The live quotes are the merchants' own.
 */
async function sweep(): Promise<void> {
  const cfg = await getConfig(ops);
  const now = await chainNow(ops);
  const mine = ops.identity.address;
  const open = new Set([...merchants.values()].flatMap((m) => [...m.quotes.keys()]));
  let cancelled = 0;
  let closed = 0;
  for (const { address: order, data: o } of await findOrders(ops, { payer: mine, state: OrderState.AwaitingPayment })) {
    if (open.has(order) || backedOff(order) || now < o.createdAt + BigInt(cfg.params.unpaidSecs) + 15n) continue;
    try {
      await cancelUnpaid(ops, order, o);
      cancelled += 1;
    } catch (e) {
      failed(order, 'cancel', e);
    }
  }
  for (const { address: order, data: o } of await findOrders(ops, { payer: mine, state: OrderState.Cancelled })) {
    if (backedOff(order) || now <= o.settledAt + BigInt(cfg.params.unpaidSecs)) continue;
    try {
      await closeOrder(ops, order, o);
      closed += 1;
    } catch (e) {
      failed(order, 'close', e);
    }
  }
  if (cancelled || closed) console.log(`[crank] cancelled ${cancelled} unpaid quote(s) past their payment window; closed ${closed} cancelled order(s) for their rent`);
  // evidence nobody can dispute any more
  const dropped = pruneEvidence(cfg);
  if (dropped) console.log(`[crank] dropped ${dropped} old deliveries from the evidence file`);
}

let tidying = false;
async function tidy(): Promise<void> {
  if (tidying) return;
  tidying = true;
  try {
    await season().catch((e) => console.warn(`[crank] season: ${publicMessage(e).slice(0, 120)}`));
    await sweep().catch((e) => console.warn(`[crank] sweep: ${publicMessage(e).slice(0, 120)}`));
  } finally {
    tidying = false;
  }
}

let cranking = false;
async function tick(): Promise<void> {
  if (cranking || !ready) return;
  cranking = true;
  try {
    await crank(await chainNow(ops));
  } catch (e) {
    console.warn(`[crank] ${publicMessage(e).slice(0, 160)}`);
  } finally {
    cranking = false;
  }
}

// A no-show order never reaches `pending`, so watch failed fulfilments for it.
for (const m of merchants.values()) {
  if (m.behaviour !== 'no-show') continue;
  const original = m.fulfil.bind(m);
  m.fulfil = async (order, payment, client) => {
    try {
      return await original(order, payment, client);
    } catch (e) {
      if (/did not deliver/.test((e as Error).message)) noShow.push({ merchant: m, order });
      throw e;
    }
  };
}

/**
 * Pick up where a previous run left off. The chain and the files are the only
 * state that matters: any order of ours that is still open gets cranked.
 * Quotes that were paid while the server was down are delivered or refunded
 * by the first passes of the crank, from the quotes that were kept on disk.
 */
async function recover(): Promise<void> {
  let held = 0;
  for (const m of merchants.values()) {
    for (const { address: order, data: o } of await findOrders(ops, { merchant: m.wallet })) {
      if (o.state === OrderState.Delivered || o.state === OrderState.Disputed) {
        m.pending.set(order, o.state === OrderState.Disputed ? 0 : Number(o.releaseAt));
        held += 1;
      } else if ((o.state === OrderState.Released || o.state === OrderState.Resolved) && !o.merchantReviewed) {
        m.pending.set(order, 0);
      } else if (o.state === OrderState.Funded && m.behaviour === 'no-show') {
        noShow.push({ merchant: m, order });
      }
      if (o.state === OrderState.Released && o.instant && !o.seasoned && !o.complained) seasoning.add(order);
    }
  }
  if (held) console.log(`  recovered ${held} open order(s)`);
}

/** Retry a start-up step until it works: an outage at boot must not leave the service down. */
async function until<T>(what: string, step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step();
    } catch (e) {
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
      console.warn(`  ${what} failed (${publicMessage(e).slice(0, 120)}); trying again in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

async function start(): Promise<void> {
  const cfg = await until('reading the Tessera config', () => getConfig(ops));
  await until('recovery', recover);
  ready = true;
  console.log(`Tessera agents on ${config.publicUrl} (listening on ${config.host}:${config.port})`);
  if (restored || restoredQuotes) console.log(`  restored ${restored} earlier deliveries for the arbiter and ${restoredQuotes} open quote(s)`);
  console.log(`  state: ${dataDir()}${stateProblem ? '  (NOT SAFE: refusing orders)' : ''}`);
  console.log(`  trust proxy: ${config.trustProxy || 'off'}`);
  console.log(`  facilitators: ${(await facilitators()).map((f) => f.url).join(', ') || 'NONE REACHABLE'}`);
  console.log(`  holds by tier: ${TIER_NAMES.map((t, i) => `${t} ${cfg.params.holdSecs[i]}s`).join(', ')}; fee ${cfg.feeBps / 100}%`);
  for (const m of merchants.values()) {
    console.log(`  ${m.id.padEnd(8)} ${m.wallet}  ${m.services.map((s) => `${s.sku} ${fromUnits(s.price)}`).join(', ')}`);
  }
  setInterval(() => void tick(), config.crankEveryMs);
  setInterval(() => void tidy(), 90_000);
  void tidy();
}

const server = app.listen(config.port, config.host, () => {
  void start().catch((e) => console.error(`startup: ${publicMessage(e)}`));
});
server.on('error', (e) => {
  console.error(`could not listen on ${config.host}:${config.port}: ${publicMessage(e)}`);
  process.exit(1);
});
// Slow clients cannot hold sockets open; the crank, not a request, waits on the chain.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

// A redeploy: stop taking orders, let the ones being delivered finish, then go.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (draining) return;
    draining = true;
    console.log(`${signal}: finishing ${[...merchants.values()].reduce((n, m) => n + m.inflight.size, 0)} delivery(ies), then stopping`);
    server.close();
    void (async () => {
      const until = Date.now() + 25_000;
      while (Date.now() < until && [...merchants.values()].some((m) => m.inflight.size)) await sleep(250);
      process.exit(0);
    })();
  });
}

export type { Actor };
