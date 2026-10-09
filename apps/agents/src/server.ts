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
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { address, lamports } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { agentPdaOf, bytesEqual, fetchAllOrders, fromUnits, getCancelUnpaidInstructionAsync, getCloseOrderInstructionAsync, TIER_NAMES } from '@tessera/sdk';
import { ADVERSARIES, keyPath, MERCHANTS } from '../../../scripts/cast.js';
import { chainNow, clientForSigner, loadKeypair, tokenHelpers } from '../../../scripts/lib.js';
import { agentCard, handleRpc } from './a2a.js';
import {
  getConfig,
  OrderState,
  readOrder,
  refund,
  release,
  resolveDispute,
  send,
  submitReview,
  vaultBalance,
  type Actor,
} from './chain.js';
import { config } from './config.js';
import { facilitators } from './facilitator.js';
import { loadEvidence, MerchantAgent, type Behaviour } from './merchant.js';
import { hashOf } from './services.js';

const ops = clientForSigner(await loadKeypair('.keys/server.json'));
const arbiter = clientForSigner(await loadKeypair('.keys/arbiter.json'));

const merchants = new Map<string, MerchantAgent>();
for (const m of [...MERCHANTS, ...ADVERSARIES.filter((a) => a.role === 'merchant')]) {
  const behaviour: Behaviour = m.behaviour === 'no-show' ? 'no-show' : 'honest';
  merchants.set(m.id, new MerchantAgent(m.id, m.title, clientForSigner(await loadKeypair(keyPath(m.id))), ops, behaviour));
}

// The arbiter's evidence from earlier runs.
let restored = 0;
for (const e of loadEvidence()) {
  const m = merchants.get(e.merchant);
  if (m) {
    m.deliveries.set(e.order, { sku: e.sku, deliverable: e.deliverable });
    restored += 1;
  }
}

const app = express();
// A number is a hop count (1 behind one proxy, as on Railway); anything else, addresses or names.
if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
app.use(cors({ origin: config.webOrigins, exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }));
app.use(express.json({ limit: '64kb' }));

/**
 * A fixed window of requests per client. Quotes open orders on-chain and the
 * faucet hands out funds, and both are paid for by this server, so a script
 * inventing wallet addresses must not be able to call them without end.
 */
function perClient(what: string, max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, h] of hits) if (h.until < now) hits.delete(k);
    const key = req.ip ?? 'unknown';
    const h = hits.get(key);
    if (!h || h.until < now) {
      hits.set(key, { n: 1, until: now + windowMs });
      return next();
    }
    if (h.n >= max) return void res.status(429).json({ error: `too many ${what} from this address; try again in ${Math.ceil((h.until - now) / 1000)} s` });
    h.n += 1;
    next();
  };
}
const quoteLimit = perClient('quotes', config.quotesPerMinute, 60_000);
const faucetLimit = perClient('faucet requests', 3, 3_600_000);

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const merchantOf = (req: Request, res: Response): MerchantAgent | null => {
  const m = merchants.get(String(req.params.id));
  if (!m) res.status(404).json({ error: 'unknown agent' });
  return m ?? null;
};

// For a host's health check: answers at once, with no network calls.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health', async (_req, res) => {
  res.json({ ok: true, network: config.network, facilitators: (await facilitators()).map((f) => f.url) });
});

app.get('/agents', async (_req, res) => {
  res.json(
    await Promise.all(
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
});

// ------------------------------------------------------------------ A2A
app.get('/agents/:id/.well-known/agent-card.json', async (req, res) => {
  const m = merchantOf(req, res);
  if (m) res.json(await agentCard(m));
});

app.post('/agents/:id/a2a', (req, res, next) => (req.body?.params?.message?.taskId ? next() : quoteLimit(req, res, next)), async (req, res) => {
  const m = merchantOf(req, res);
  if (!m) return;
  const id = req.body?.id ?? null;
  try {
    const out = await handleRpc(m, req.body ?? {}, req.header('X-A2A-Extensions'));
    if ('result' in out) res.setHeader('X-A2A-Extensions', req.header('X-A2A-Extensions') ?? '');
    res.json({ jsonrpc: '2.0', id, ...out });
  } catch (e) {
    console.error('[a2a]', e);
    res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
  }
});

// ------------------------------------------------------- plain HTTP 402
app.get('/agents/:id/x402/:skill', (req, res, next) => (req.header('PAYMENT-SIGNATURE') ? next() : quoteLimit(req, res, next)), async (req, res) => {
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
      });
      res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(quote.required));
      return void res.status(402).json(quote.required);
    }
    const payload = decodePaymentSignatureHeader(header);
    const f = await m.fulfil(payload.accepted.payTo, payload);
    if (f.receipts[0]) res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(f.receipts[0]));
    res.json({ result: f.deliverable, escrow: { order: f.order, deliveryHash: f.deliveryHash, state: f.state, instant: f.instant, releaseAt: f.releaseAt } });
  } catch (e) {
    // Once money has moved, never invite the client to pay again.
    const paid = Boolean(header);
    res.status(paid ? 502 : 400).json({
      error: (e as Error).message,
      ...(paid ? { note: 'Do not pay again. If the escrow was funded, it refunds at the delivery deadline.' } : {}),
    });
  }
});

// ------------------------------------------------- website wallet checkout
app.get('/api/catalog', async (_req, res) => {
  res.json(
    [...merchants.values()]
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
      ),
  );
});

app.post('/api/orders', quoteLimit, async (req, res) => {
  try {
    const m = merchants.get(String(req.body?.merchant));
    if (!m) return void res.status(404).json({ error: 'unknown merchant' });
    const quote = await m.quote({
      buyer: String(address(String(req.body?.buyer))),
      sku: String(req.body?.sku),
      input: req.body?.input ?? {},
      minHoldSecs: Number(req.body?.minHoldSecs ?? 0) || undefined,
      resourceUrl: `${config.publicUrl}/api/orders`,
    });
    quote.claim = randomBytes(18).toString('base64url');
    res.json({ terms: quote.terms, required: quote.required, claim: quote.claim });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/**
 * Called after the buyer's wallet has funded the vault. The program decides
 * whether it did. The order address is public, so the caller also shows the
 * claim that only the quote's requester was given.
 */
app.post('/api/orders/:order/fulfil', async (req, res) => {
  const order = String(req.params.order);
  const m = [...merchants.values()].find((x) => x.quotes.has(order));
  const claim = m?.quotes.get(order)?.claim;
  if (!m || !claim) return void res.status(404).json({ error: 'unknown or already fulfilled order' });
  if (!sameSecret(String(req.body?.claim ?? ''), claim)) return void res.status(403).json({ error: 'this order was quoted to someone else' });
  try {
    const f = await m.fulfil(order);
    res.json(f);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ------------------------------------------------------------ demo faucet
// Devnet only: a little SOL and test USDC so a visitor (or the site's
// built-in test wallet) can try a purchase without hunting for a faucet.
const DRIP_USDC = 800_000n;
const dripped = new Set<string>();
const dripping = new Set<string>();
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

app.post('/api/faucet', faucetLimit, async (req, res) => {
  let to: ReturnType<typeof address> | undefined;
  try {
    to = address(String(req.body?.wallet));
    const hour = Date.now() - 3_600_000;
    while (drips.length && drips[0]! < hour) drips.shift();
    if (dripped.has(to) || dripping.has(to)) return void res.status(429).json({ error: 'this wallet was already funded' });
    if (drips.length >= 20) return void res.status(429).json({ error: 'the demo faucet is resting; try again in an hour or use faucet.circle.com' });
    dripping.add(to);
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
    drips.push(Date.now());
    res.json({ sol: '0.02', usdc: fromUnits(DRIP_USDC), signature });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message.slice(0, 200) });
  } finally {
    if (to) dripping.delete(to);
  }
});

// ---------------------------------------------------------------- the crank
const noShow: { merchant: MerchantAgent; order: string }[] = [];

async function crank(now: bigint): Promise<void> {
  const cfg = await getConfig(ops);
  for (const m of merchants.values()) {
    // Unpaid quotes: give the rent back once the payment window has passed.
    for (const [order, q] of m.quotes) {
      if (Date.now() - q.openedAt < (cfg.params.unpaidSecs + 15) * 1000) continue;
      const o = await readOrder(ops, q.terms.order);
      if (!o || o.state !== OrderState.AwaitingPayment) {
        if (o && o.state === OrderState.Funded && m.behaviour === 'no-show') noShow.push({ merchant: m, order });
        m.quotes.delete(order);
        continue;
      }
      await send(ops, [
        await getCancelUnpaidInstructionAsync({ order: q.terms.order, mint: o.mint, payer: ops.identity.address, authority: ops.identity }),
      ]).catch((e) => console.warn(`[crank] cancel ${order.slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`));
      m.quotes.delete(order);
    }

    for (const [order, due] of [...m.pending]) {
      if (now < BigInt(due)) continue;
      let o = await readOrder(ops, address(order));
      if (o && o.state === OrderState.Delivered) {
        if (now < o.releaseAt) continue;
        await release(ops, address(order), o);
        console.log(`[crank] released ${order.slice(0, 8)} to ${m.id} after a ${Number(o.releaseAt - o.deliveredAt)}s hold`);
        o = await readOrder(ops, address(order));
      }
      if (o && o.state === OrderState.Disputed) {
        await arbitrate(m, order, o);
        o = await readOrder(ops, address(order));
      }
      // The program weighs a merchant's review of a released order only once
      // the buyer has reviewed it, so wait for that until the window closes.
      if (o && !o.merchantReviewed && o.state === OrderState.Released && !o.buyerReviewed) {
        // Look again in half a minute, not every tick: the RPC budget is shared.
        if (now <= o.settledAt + BigInt(cfg.params.reviewSecs)) m.pending.set(order, Number(now) + 30);
        else m.pending.delete(order);
        continue;
      }
      if (o && !o.merchantReviewed && (o.state === OrderState.Released || o.state === OrderState.Resolved)) {
        const buyerLost = o.state === OrderState.Resolved && o.refunded === 0n;
        if (o.state === OrderState.Released || buyerLost) {
          await submitReview(m.signer, ops, address(order), o, buyerLost ? 1 : 5, buyerLost ? 'Disputed a delivery that matched its hash.' : 'Paid in full.').catch(
            (e) => console.warn(`[crank] review ${order.slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`),
          );
        }
      }
      if (!o || o.state !== OrderState.Delivered) m.pending.delete(order);
    }
  }

  // A merchant that took an order and went quiet: anyone may refund the buyer at the deadline.
  for (let i = noShow.length - 1; i >= 0; i -= 1) {
    const { merchant, order } = noShow[i]!;
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
  }
}

/**
 * The demo arbiter. It does one honest check: is what the merchant holds the
 * thing whose hash it committed on-chain, and is it a valid answer to what
 * was ordered? If so the dispute is unfounded. With no evidence on file it
 * cannot tell, so it splits the vault evenly, which penalises nobody: losing
 * the file must not hand every disputing buyer a win.
 */
async function arbitrate(m: MerchantAgent, order: string, o: NonNullable<Awaited<ReturnType<typeof readOrder>>>): Promise<void> {
  const d = m.deliveries.get(order);
  if (!d) {
    await resolveDispute(arbiter, address(order), o, 5_000);
    console.log(`[arbiter] ${order.slice(0, 8)}: no record of what ${m.id} delivered; split evenly, nobody penalised`);
    return;
  }
  const matches = bytesEqual(await hashOf(d.deliverable), o.deliveryHash);
  const valid = m.service(d.sku).valid(d.deliverable);
  const merchantBps = matches && valid ? 10_000 : 0;
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
 */
async function season(): Promise<void> {
  const cfg = await getConfig(ops);
  const now = await chainNow(ops);
  const ours = new Set([...merchants.values()].map((m) => m.wallet as string));
  let freed = 0;
  for (const { address: order, data: o } of await fetchAllOrders(ops.rpc as never)) {
    if (!ours.has(o.merchant) || o.state !== OrderState.Released) continue;
    if (!o.instant || o.seasoned || o.complained) continue;
    if (now <= o.settledAt + BigInt(cfg.params.reviewSecs)) continue;
    await send(ops, [await getCloseOrderInstructionAsync({ order, merchantAgent: await agentPdaOf(o.merchant), payer: o.payer })])
      .then(() => (freed += 1))
      .catch(() => undefined);
  }
  if (freed) console.log(`[crank] closed ${freed} unrated instant order(s); their amounts no longer count against the merchants' limits`);
}
setInterval(() => {
  void season().catch((e) => console.warn(`[crank] season: ${(e as Error).message.slice(0, 120)}`));
  void sweepQuotes()
    .then((n) => n && console.log(`[crank] cancelled ${n} unpaid quote(s) past their payment window`))
    .catch((e) => console.warn(`[crank] sweep: ${(e as Error).message.slice(0, 120)}`));
}, 90_000);

let cranking = false;
setInterval(async () => {
  if (cranking) return;
  cranking = true;
  try {
    await crank(await chainNow(ops));
  } catch (e) {
    console.warn(`[crank] ${(e as Error).message.slice(0, 160)}`);
  } finally {
    cranking = false;
  }
}, config.crankEveryMs);

// A no-show order never reaches `pending`, so watch failed fulfilments for it.
for (const m of merchants.values()) {
  if (m.behaviour !== 'no-show') continue;
  const original = m.fulfil.bind(m);
  m.fulfil = async (order, payment) => {
    try {
      return await original(order, payment);
    } catch (e) {
      if (/did not deliver/.test((e as Error).message)) noShow.push({ merchant: m, order });
      throw e;
    }
  };
}

/**
 * Quotes nobody paid. The live crank cancels the ones this process issued; this
 * sweep reads the chain instead, so a quote from before a restart, or one that
 * was still inside its payment window when we restarted, is cancelled too and
 * its rent comes back.
 */
async function sweepQuotes(known?: Awaited<ReturnType<typeof fetchAllOrders>>): Promise<number> {
  const orders = known ?? (await fetchAllOrders(ops.rpc as never));
  const cfg = await getConfig(ops);
  const now = await chainNow(ops);
  const tok = tokenHelpers(ops, cfg.mint);
  let cancelled = 0;
  for (const { address: order, data: o } of orders) {
    if (o.state !== OrderState.AwaitingPayment || o.payer !== ops.identity.address) continue;
    if (now < o.createdAt + BigInt(cfg.params.unpaidSecs) + 15n) continue;
    const paidIn = await vaultBalance(ops, await tok.ata(order));
    await send(ops, [
      await getCancelUnpaidInstructionAsync({
        order,
        mint: o.mint,
        payer: ops.identity.address,
        authority: ops.identity,
        // anything that did reach the vault goes back to the buyer
        ...(paidIn > 0n ? { buyerToken: await tok.ata(o.buyer) } : {}),
      }),
    ])
      .then(() => (cancelled += 1))
      .catch(() => undefined);
  }
  return cancelled;
}

/**
 * Pick up where a previous run left off. The chain is the only state that
 * matters: any order of ours that is still open gets cranked, and one we were
 * paid for but can no longer fulfil is refunded.
 */
async function recover(): Promise<void> {
  const byWallet = new Map([...merchants.values()].map((m) => [m.wallet as string, m]));
  const orders = await fetchAllOrders(ops.rpc as never);
  let held = 0;
  let refunded = 0;
  for (const { address: order, data: o } of orders) {
    const m = byWallet.get(o.merchant);
    if (!m) continue;
    if (o.state === OrderState.Delivered || o.state === OrderState.Disputed) {
      m.pending.set(order, Number(o.releaseAt));
      held += 1;
    } else if ((o.state === OrderState.Released || o.state === OrderState.Resolved) && !o.merchantReviewed) {
      m.pending.set(order, 0);
    } else if (o.state === OrderState.Funded) {
      if (m.behaviour === 'no-show') noShow.push({ merchant: m, order });
      else {
        await refund(m.signer, order, o).catch(() => undefined);
        refunded += 1;
      }
    }
  }
  const cancelled = await sweepQuotes(orders);
  if (held || refunded || cancelled) {
    console.log(`  recovered ${held} open order(s); refunded ${refunded} paid order(s) lost in a restart; cancelled ${cancelled} unpaid quote(s)`);
  }
}

app.listen(config.port, async () => {
  const cfg = await getConfig(ops);
  await recover().catch((e) => console.warn(`  recovery skipped: ${(e as Error).message.slice(0, 120)}`));
  console.log(`Tessera agents on ${config.publicUrl}`);
  if (restored) console.log(`  arbiter evidence: ${restored} earlier deliveries on file`);
  console.log(`  facilitators: ${(await facilitators()).map((f) => f.url).join(', ') || 'NONE REACHABLE'}`);
  console.log(`  holds by tier: ${TIER_NAMES.map((t, i) => `${t} ${cfg.params.holdSecs[i]}s`).join(', ')}; fee ${cfg.feeBps / 100}%`);
  for (const m of merchants.values()) {
    console.log(`  ${m.id.padEnd(8)} ${m.wallet}  ${m.services.map((s) => `${s.sku} ${fromUnits(s.price)}`).join(', ')}`);
  }
});

export type { Actor };
