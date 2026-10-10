/**
 * A merchant agent: quotes a price by opening an escrow, and once the escrow
 * is funded does the work, commits a hash of it on-chain and hands it over.
 */
import { readFileSync } from 'node:fs';
import { address, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, verifySignature, type Address } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { decodeTransactionFromPayload, getTokenPayerFromTransaction } from '@x402/svm';
import { bytesEqual, fromHex, fromUnits, MAX_HOLD_SECS, score, TESSERA_PROGRAM_ADDRESS, TIER_NAMES, toHex, type Config, type Decoded, type Order } from '@tessera/sdk';
import {
  cancelUnpaid,
  confirmFunded,
  deliver,
  getConfig,
  openOrder,
  OrderState,
  readAgent,
  readOrder,
  readUntil,
  refund,
  vaultBalance,
  type Actor,
} from './chain.js';
import { config } from './config.js';
import { facilitators, verifyAndSettle } from './facilitator.js';
import { canonical, hashOf, SERVICES, type Service } from './services.js';
import { appendLineDurable, dataFile, readJsonFile, writeFileDurable } from './store.js';
import { chainNow } from '../../../scripts/lib.js';

/**
 * A funded order is delivered, or refunded by its merchant (which costs the
 * merchant nothing), at least this long before its delivery deadline: a few
 * blockhash lifetimes, so the refund lands in time even after retries. Past
 * the deadline anyone may refund it, and the merchant takes the penalty.
 * Capped at a third of the window, for networks with a short one.
 */
export const refundMargin = (cfg: Config): bigint => BigInt(Math.max(1, Math.min(180, Math.floor(cfg.params.deliverSecs / 3))));
/** An x402 payment is not forwarded this close to the end of the payment window: it could land too late to confirm. */
const PAY_MARGIN_SECS = 30n;
/** The most a request's input may weigh. Each service has its own limits on top. */
const MAX_INPUT_BYTES = 8192;
/** A funded order is left this long for the buyer's own call to deliver it, before the crank steps in. */
const FULFIL_GRACE_SECS = 15n;
/** Evidence and results are kept this long past the end of the dispute window, for clock skew and a slow arbiter. */
const KEEP_EXTRA_SECS = 3600;

/**
 * What each merchant delivered is the arbiter's evidence, so it is written to
 * disk before the hash goes on-chain and outlives a restart. Kept out of git.
 * `at` and `holdSecs` say when the dispute window closes, so old entries can go.
 */
const EVIDENCE_NAME = 'deliveries.jsonl';
export type Evidence = { merchant: string; order: string; sku: string; deliverable: unknown; input?: unknown; at?: number; holdSecs?: number };
type DeliveryRecord = { sku: string; deliverable: unknown; input?: unknown; at?: number; holdSecs?: number };

/**
 * Append one delivery and flush it to the disk. Throws if it cannot, and then
 * the delivery is not made: a hash on-chain with no record behind it is a
 * dispute the arbiter cannot rule on.
 */
function keepEvidence(e: Evidence): void {
  appendLineDurable(dataFile(EVIDENCE_NAME), JSON.stringify(e));
}

/** Every delivery kept so far, oldest first. */
export function loadEvidence(): Evidence[] {
  const file = dataFile(EVIDENCE_NAME);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[evidence] could not read ${file}: ${(err as Error).message}`);
    return [];
  }
  const out: Evidence[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Evidence);
    } catch {
      // a line cut short by a crash is skipped
    }
  }
  return out;
}

/** Nobody can dispute this delivery any more, so the arbiter has no use for it. */
function stale(e: { at?: number; holdSecs?: number }, complaintSecs: number, nowMs = Date.now()): boolean {
  if (e.at === undefined) return false;
  return nowMs / 1000 > e.at / 1000 + (e.holdSecs ?? MAX_HOLD_SECS) + complaintSecs + KEEP_EXTRA_SECS;
}

/**
 * Rewrite the evidence without the deliveries nobody can dispute any more,
 * so the file does not grow without end. Written to a new file and renamed
 * over the old one, so a crash leaves one or the other. Returns how many
 * were dropped.
 */
export function compactEvidence(complaintSecs: number): number {
  const all = loadEvidence();
  const keep = all.filter((e) => !stale(e, complaintSecs));
  if (keep.length === all.length) return 0;
  writeFileDurable(dataFile(EVIDENCE_NAME), keep.map((e) => JSON.stringify(e) + '\n').join(''));
  return all.length - keep.length;
}

export type EscrowTerms = {
  program: string;
  orderId: string;
  order: Address;
  vault: Address;
  merchant: Address;
  buyer: Address;
  amount: string;
  mint: Address;
  holdSecs: number;
  buyerTier: string;
  merchantTier: string;
  buyerScore: number;
  merchantScore: number;
  pairTrusted: boolean;
  requestHash: string;
  openTx: string;
};

export type Quote = {
  sku: string;
  input: unknown;
  terms: EscrowTerms;
  required: PaymentRequired;
  openedAt: number;
  /** Who asked for it (a network address), for the caps on what one client may leave unpaid. */
  client: string;
  /** The crank leaves it alone until then, after a step that failed. */
  retryAt?: number;
  /** Delivery failed for good: once paid, the order is refunded, not retried. */
  doomed?: boolean;
  /**
   * Handed only to whoever asked for the quote. The website's checkout must
   * show it to collect the delivery, so someone watching the chain cannot
   * collect a delivery another wallet paid for.
   */
  claim?: string;
};

export type Fulfilment = {
  deliverable: unknown;
  deliveryHash: string;
  order: Address;
  state: string;
  instant: boolean;
  releaseAt: number;
  receipts: SettleResponse[];
  timings: Record<string, number>;
  deliverTx: string;
};

/** A delivery made, with what is needed to hand it over again. */
type Delivered = { f: Fulfilment; claim?: string; client: string; proof: string; at: number };

export type Behaviour = 'honest' | 'no-show' | 'junk';

/**
 * The x402 payment is one token transfer of the order's amount into the
 * order's vault, authorised by `buyer`, and `buyer` really signed it. Checked
 * here, not left to the facilitator: a facilitator that says "success" for a
 * payment that did not fund this order must not make us deliver it.
 */
async function paysThisOrder(payment: PaymentPayload, terms: EscrowTerms): Promise<boolean> {
  try {
    const buyer = terms.buyer;
    const tx = decodeTransactionFromPayload(payment.payload as { transaction: string });
    if (getTokenPayerFromTransaction(tx) !== buyer) return false;
    const signature = tx.signatures[buyer];
    if (!signature || !(await verifySignature(await getPublicKeyFromAddress(buyer), signature, tx.messageBytes))) return false;

    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    // the payment scheme signs legacy or v0 messages with no lookup tables
    if (msg.version === 1 || (msg.version === 0 && msg.addressTableLookups?.length)) return false;
    const keys = msg.staticAccounts;
    const tokenIxs = msg.instructions.filter((ix) => keys[ix.programAddressIndex] === TOKEN_PROGRAM_ADDRESS);
    if (tokenIxs.length !== 1) return false;
    const ix = tokenIxs[0]!;
    const data = ix.data;
    // TransferChecked: [12, amount u64 LE, decimals]; accounts source, mint, destination, authority
    if (!data || data.length !== 10 || data[0] !== 12) return false;
    const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
    const [, mint, destination, authority] = (ix.accountIndices ?? []).map((i) => keys[i]);
    return amount === BigInt(terms.amount) && mint === terms.mint && destination === terms.vault && authority === buyer;
  } catch {
    // an undecodable payment is refused
    return false;
  }
}

async function readStanding(m: MerchantAgent) {
  const [me, cfg] = await Promise.all([readAgent(m.ops, m.wallet), getConfig(m.ops)]);
  if (!me) return { score: 0, tier: TIER_NAMES[0], instantLimit: '0' };
  const e = score.evaluate(me, cfg.params, BigInt(Math.floor(Date.now() / 1000)));
  return {
    score: e.score,
    tier: TIER_NAMES[e.tier],
    stars: score.averageStars(me, cfg.params),
    settledOrders: me.asMerchant.orders,
    holdSecsAtThisTier: cfg.params.holdSecs[e.tier],
    instantLimit: score.instantLimit(me, cfg.params).toString(),
  };
}
type Standing = Awaited<ReturnType<typeof readStanding>>;

type SavedState = { v: 1; quotes: Record<string, Quote>; fulfilled: Record<string, Delivered> };

export class MerchantAgent {
  /** Orders this merchant quoted and has not yet delivered, by order address. Kept on disk across restarts. */
  readonly quotes = new Map<string, Quote>();
  /**
   * Fulfilments under way, by order address, with the payment that started
   * each. A second call for the same order shares the first one's work, so
   * the service runs once and its evidence is written once.
   */
  readonly inflight = new Map<string, { payment: string; client: string; done: Promise<Fulfilment> }>();
  /**
   * What each delivered order was handed, so the holder of its claim can
   * fetch it again after a lost response. Kept on disk until the order's
   * dispute window is long over (see prune).
   */
  readonly fulfilled = new Map<string, Delivered>();
  /** What was delivered, kept so the arbiter can check a dispute. Every attempt is kept: the one whose hash is on-chain counts. */
  readonly deliveries = new Map<string, DeliveryRecord[]>();
  /** Orders to look at again, and the chain time from which to look (their release time). */
  readonly pending = new Map<string, number>();
  readonly services: Service[];
  /** Quotes being opened right now. They count against the caps like open ones, so a burst cannot get past them. */
  private readonly opening = new Set<{ buyer: Address; client: string }>();
  private standingCache?: { at: number; value: Promise<Standing> };

  constructor(
    readonly id: string,
    readonly title: string,
    /** Signs deliveries. */
    readonly signer: Actor,
    /** Fronts rent for orders, so buyers need no SOL. */
    readonly ops: Actor,
    readonly behaviour: Behaviour = 'honest',
  ) {
    this.services = SERVICES[id] ?? [];
    this.restore();
  }

  get wallet(): Address {
    return this.signer.identity.address;
  }

  service(sku: string): Service {
    const s = this.services.find((x) => x.sku === sku);
    if (!s) throw new Error(`${this.id} does not sell "${sku}"`);
    return s;
  }

  private get stateFile(): string {
    return dataFile(`merchant-${this.id.replace(/[^\w-]/g, '_')}.json`);
  }

  /**
   * Quotes and results come back after a restart: a buyer who paid a quote
   * from before it is still served, and one the merchant can no longer serve
   * is found by the crank and refunded.
   */
  private restore(): void {
    try {
      const saved = readJsonFile<SavedState>(this.stateFile);
      for (const [k, q] of Object.entries(saved?.quotes ?? {})) this.quotes.set(k, q);
      for (const [k, d] of Object.entries(saved?.fulfilled ?? {})) this.fulfilled.set(k, d);
    } catch (err) {
      // not fatal: an order that was paid and is not here is refunded, not left to expire
      console.error(`[state] could not read ${this.stateFile}: ${(err as Error).message}`);
    }
  }

  /** Write quotes and results to disk. A failure is logged: the order they describe is already on-chain. */
  private save(): void {
    try {
      const state: SavedState = { v: 1, quotes: Object.fromEntries(this.quotes), fulfilled: Object.fromEntries(this.fulfilled) };
      writeFileDurable(this.stateFile, JSON.stringify(state));
    } catch (err) {
      console.error(`[state] could not write ${this.stateFile}: ${(err as Error).message}`);
    }
  }

  /** Open quotes, and quotes being opened, that match. */
  private openCount(match: (q: { buyer: Address; client: string }) => boolean): number {
    let n = 0;
    for (const q of this.quotes.values()) if (match({ buyer: q.terms.buyer, client: q.client })) n += 1;
    for (const q of this.opening) if (match(q)) n += 1;
    return n;
  }

  /** The claim that collects this order's delivery, while there is one to collect. */
  claimOf(order: string): string | undefined {
    return this.quotes.get(order)?.claim ?? this.fulfilled.get(order)?.claim;
  }

  /** Give a quote the claim that only its requester holds. */
  setClaim(order: string, claim: string): void {
    const q = this.quotes.get(order);
    if (!q) return;
    q.claim = claim;
    this.save();
  }

  /** Drop what was kept for orders whose dispute window is long over. */
  private prune(cfg: Config): void {
    for (const [order, recs] of this.deliveries) {
      const keep = recs.filter((r) => !stale(r, cfg.params.complaintSecs));
      if (!keep.length) this.deliveries.delete(order);
      else if (keep.length !== recs.length) this.deliveries.set(order, keep);
    }
    let dropped = false;
    for (const [order, d] of this.fulfilled) {
      if (stale({ at: Math.max(d.at, d.f.releaseAt * 1000), holdSecs: 0 }, cfg.params.complaintSecs)) {
        this.fulfilled.delete(order);
        dropped = true;
      }
    }
    if (dropped) this.save();
  }

  private record(order: string, rec: DeliveryRecord): void {
    const list = this.deliveries.get(order) ?? [];
    list.push(rec);
    this.deliveries.set(order, list);
  }

  /**
   * What the arbiter judges a dispute by: the delivery whose hash is the one
   * committed on-chain. `any` says whether anything is on file for the order
   * at all.
   */
  async evidenceFor(order: string, deliveryHash: Order["deliveryHash"]): Promise<{ any: boolean; match?: DeliveryRecord }> {
    const recs = this.deliveries.get(order) ?? [];
    for (const r of recs) if (bytesEqual(await hashOf(r.deliverable), deliveryHash)) return { any: true, match: r };
    return { any: recs.length > 0 };
  }

  /**
   * Quote: open an escrow for this buyer and describe how to fund it. The
   * x402 `payTo` is the order account itself, so a spec-compliant payment
   * lands in escrow with no custom scheme.
   */
  async quote(req: { buyer: string; sku: string; input?: unknown; minHoldSecs?: number; resourceUrl: string; client?: string }): Promise<Quote> {
    const buyer = address(req.buyer);
    const service = this.service(req.sku);
    const input = req.input ?? {};
    if (typeof input !== 'object' || input === null || Array.isArray(input) || canonical(input).length > MAX_INPUT_BYTES) {
      throw new Error(`input must be a JSON object of at most ${MAX_INPUT_BYTES} bytes`);
    }
    const refused = service.rejects(input);
    if (refused) throw new Error(refused);
    const minHoldSecs = req.minHoldSecs ?? 0;
    if (!Number.isInteger(minHoldSecs) || minHoldSecs < 0 || minHoldSecs > MAX_HOLD_SECS) {
      throw new Error(`minHoldSecs must be a whole number of seconds from 0 to ${MAX_HOLD_SECS}`);
    }
    // Every quote fronts rent, and buyer addresses cost nothing to invent. The
    // caps count what each client asked for, so nobody can use up another
    // buyer's quota by naming it, and this quote's slot is taken before the
    // first await, so a burst of requests cannot all pass the same check.
    const client = req.client ?? 'local';
    if (this.openCount((q) => q.client === client && q.buyer === buyer) >= config.maxUnpaidPerBuyer) {
      throw new Error('too many unpaid orders for this wallet; pay or wait for them to expire');
    }
    if (this.openCount((q) => q.client === client) >= config.maxUnpaidPerClient) {
      throw new Error('too many unpaid quotes from this address; pay or wait for them to expire');
    }
    if (this.quotes.size + this.opening.size >= config.maxOpenQuotes) {
      throw new Error('this merchant has too many unpaid quotes open; try again in a few minutes');
    }
    const slot = { buyer, client };
    this.opening.add(slot);
    try {
      const cfg = await getConfig(this.ops);
      // The merchant co-signs the hold. A buyer may ask for a longer one than
      // the tiers call for, within reason: until it ends the merchant is not paid.
      const maxHold = Math.min(MAX_HOLD_SECS, 10 * cfg.params.holdSecs[0]!);
      if (minHoldSecs > maxHold) throw new Error(`minHoldSecs is at most ${maxHold} at this merchant`);
      const requestHash = await hashOf({ sku: service.sku, input });
      const opened = await openOrder(this.ops, {
        buyer,
        merchant: this.signer.identity,
        amount: service.price,
        requestHash,
        minHoldSecs: minHoldSecs || undefined,
      });
      const d = opened.data;
      const terms: EscrowTerms = {
        program: TESSERA_PROGRAM_ADDRESS,
        orderId: toHex(opened.id),
        order: opened.order,
        vault: opened.vault,
        merchant: this.wallet,
        buyer,
        amount: d.amount.toString(),
        mint: d.mint,
        holdSecs: d.holdSecs,
        buyerTier: TIER_NAMES[d.buyerTier]!,
        merchantTier: TIER_NAMES[d.merchantTier]!,
        buyerScore: d.buyerScore,
        merchantScore: d.merchantScore,
        pairTrusted: d.pairTrusted,
        requestHash: toHex(requestHash),
        openTx: opened.signature,
      };
      // One option per reachable facilitator: each pays the network fee itself,
      // so each needs its own fee payer in the payment the buyer signs.
      const accepts: PaymentRequirements[] = (await facilitators()).map((f) => ({
        scheme: 'exact',
        network: config.network as PaymentRequirements['network'],
        asset: cfg.mint,
        amount: d.amount.toString(),
        payTo: opened.order,
        maxTimeoutSeconds: 120,
        extra: { feePayer: f.feePayer, facilitator: f.url },
      }));
      const required: PaymentRequired = {
        x402Version: 2,
        resource: {
          url: req.resourceUrl,
          description: `${service.name} from ${this.id}, ${fromUnits(d.amount)} USDC into escrow`,
          mimeType: 'application/json',
        },
        accepts,
        extensions: { tessera: terms },
      };
      const quote: Quote = { sku: service.sku, input, terms, required, openedAt: Date.now(), client };
      this.quotes.set(opened.order, quote);
      this.save();
      return quote;
    } finally {
      this.opening.delete(slot);
    }
  }

  /**
   * Fund (through a facilitator, if a signed x402 payment was handed over),
   * prove funding on-chain, do the work, commit it, deliver it.
   *
   * Once per order. A call while one is under way shares its result; a call
   * after it gets the same delivery back, so the caller must have checked
   * that it may ask (the claim, or the A2A task). An x402 payment is public
   * once it lands, so it only fetches the result again for the client that
   * sent it.
   */
  async fulfil(orderAddress: string, payment?: PaymentPayload, client?: string): Promise<Fulfilment> {
    const proof = payment ? JSON.stringify(payment.payload) : '';
    const running = this.inflight.get(orderAddress);
    if (running) {
      if (running.payment !== proof || (payment && running.client !== (client ?? 'local'))) throw new Error('this order is already being fulfilled');
      return running.done;
    }
    const finished = this.fulfilled.get(orderAddress);
    if (finished) {
      if (!payment || (finished.proof === proof && finished.client === (client ?? 'local'))) return finished.f;
      throw new Error('this order was already delivered');
    }
    const quote = this.quotes.get(orderAddress);
    if (!quote) throw new Error('unknown or already fulfilled order');
    const done = this.work(orderAddress, quote, payment, proof).finally(() => this.inflight.delete(orderAddress));
    this.inflight.set(orderAddress, { payment: proof, client: client ?? 'local', done });
    return done;
  }

  private async work(orderAddress: string, quote: Quote, payment: PaymentPayload | undefined, proof: string): Promise<Fulfilment> {
    const order = quote.terms.order;
    const timings: Record<string, number> = {};
    const receipts: SettleResponse[] = [];
    const t0 = Date.now();
    const cfg = await getConfig(this.ops);

    if (payment) {
      const accepted = quote.required.accepts.find(
        (a) => a.payTo === payment.accepted.payTo && a.extra?.feePayer === payment.accepted.extra?.feePayer,
      );
      if (!accepted || payment.accepted.amount !== accepted.amount || payment.accepted.asset !== accepted.asset) {
        throw new Error('payment does not match any option that was quoted');
      }
      // The order address is public on-chain. Without this, anyone could pay
      // for an order quoted to another wallet and walk off with what that
      // wallet asked for. The buyer's signature and what it signed are checked
      // here, not left to the facilitator.
      if (!(await paysThisOrder(payment, quote.terms))) {
        throw new Error('payment does not match: it is not this order\'s buyer paying this order\'s vault');
      }
      // Only a payment that funds this order now is taken as paying for it.
      // One funded some other way is collected the way it was ordered, and
      // after settling, the vault, not the facilitator's word, says it was paid.
      const before = await readOrder(this.ops, order);
      if (!before || before.state !== OrderState.AwaitingPayment || (await vaultBalance(this.ops, quote.terms.vault)) >= before.amount) {
        throw new Error('payment does not match: this order is already paid or closed');
      }
      if ((await chainNow(this.ops)) + PAY_MARGIN_SECS > before.createdAt + BigInt(cfg.params.unpaidSecs)) {
        throw new Error('the payment window for this quote has closed; ask for a new quote');
      }
      const settled = await verifyAndSettle(payment, accepted);
      receipts.push(settled.response);
      timings.verifyMs = settled.verifyMs;
      timings.settleMs = settled.settleMs;
    }

    // The program decides whether the order is paid. Not the facilitator, not us.
    let o = await readOrder(this.ops, order);
    if (!o) throw new Error('order no longer exists');
    if (o.state === OrderState.AwaitingPayment) {
      const amount = o.amount;
      const funded = await readUntil(() => vaultBalance(this.ops, quote.terms.vault), (b) => b >= amount, 6);
      if (funded < amount) throw new Error('the escrow vault has not been funded yet');
      // The program refuses a late payment; the crank cancels the order and it goes back to the buyer.
      if ((await chainNow(this.ops)) > o.createdAt + BigInt(cfg.params.unpaidSecs)) {
        throw new Error('the payment arrived after the payment window closed; it is returned to the buyer');
      }
      const t = Date.now();
      await confirmFunded(this.ops, order, o.mint);
      timings.confirmMs = Date.now() - t;
      o = await readUntil(() => readOrder(this.ops, order), (x) => x !== null && x.state !== OrderState.AwaitingPayment);
    }
    if (o && o.state !== OrderState.Funded) {
      // Delivered before (a restart cut the answer short): hand over what was committed.
      const again = await this.recorded(orderAddress, quote, o, proof, receipts);
      if (again) return again;
    }
    if (!o || o.state !== OrderState.Funded) throw new Error(`order is ${o ? OrderState[o.state] : 'gone'}, not Funded`);

    if (this.behaviour === 'no-show') {
      // Takes the order and goes quiet. The buyer is refunded at the deadline.
      this.quotes.delete(orderAddress);
      this.save();
      throw new Error('merchant did not deliver');
    }

    // Paid for. From here on, an order this merchant does not deliver is
    // refunded at once rather than left to expire.
    const funded = o;
    try {
      const service = this.service(quote.sku);
      const margin = refundMargin(cfg);
      await this.beforeDeadline(funded, margin);
      const tWork = Date.now();
      const deliverable = await service.run(quote.input, { actor: this.signer });
      timings.workMs = Date.now() - tWork;
      // Never commit an answer this merchant's own arbiter would reject.
      if (this.behaviour === 'honest' && !service.valid(deliverable, quote.input)) {
        throw new Error('the service could not produce a valid answer to this request');
      }

      const deliveryHash = await hashOf(deliverable);
      try {
        keepEvidence({ merchant: this.id, order, sku: quote.sku, input: quote.input, deliverable, at: Date.now(), holdSecs: funded.holdSecs });
      } catch (err) {
        console.error(
          `[evidence] could not write ${dataFile(EVIDENCE_NAME)}: ${(err as Error).message}. ` +
            `Not delivering ${order}: the arbiter would have no record of it. Refunding instead.`,
        );
        throw new Error('the merchant could not record the delivery for its arbiter, so it does not deliver');
      }
      this.record(order, { sku: quote.sku, deliverable, input: quote.input, at: Date.now(), holdSecs: funded.holdSecs });
      await this.beforeDeadline(funded, margin);
      const tDeliver = Date.now();
      const { signature, instant } = await deliver(this.signer, order, funded, deliveryHash);
      timings.deliverMs = Date.now() - tDeliver;
      timings.totalMs = Date.now() - t0;

      const after = await readUntil(() => readOrder(this.ops, order), (x) => x !== null && x.state !== OrderState.Funded, 20);
      // `deliver` counts any change of state as landed; make sure it was this delivery.
      if (!after || !bytesEqual(after.deliveryHash, deliveryHash)) {
        throw new Error(`the delivery did not land; the order is ${after ? OrderState[after.state] : 'gone'}`);
      }
      return this.finish(orderAddress, quote, proof, {
        deliverable,
        deliveryHash: toHex(deliveryHash),
        order,
        state: OrderState[after.state]!,
        instant,
        releaseAt: Number(after.releaseAt),
        receipts,
        timings,
        deliverTx: signature,
      }, after);
    } catch (e) {
      const back = await this.giveBack(orderAddress, quote, proof, receipts);
      if (back.delivered) return back.delivered;
      // Forget the quote only once the order is off our hands. If the refund
      // failed too, the crank refunds it, and does not try to deliver again.
      if (back.done) this.quotes.delete(orderAddress);
      else quote.doomed = true;
      this.save();
      throw new Error(`${(e as Error).message}${back.note}`);
    }
  }

  /** A delivery that landed: remember the result, and have the crank watch the order. */
  private finish(orderAddress: string, quote: Quote, proof: string, f: Fulfilment, o: Order): Fulfilment {
    // Held orders are cranked when the hold ends; instant ones are just rated.
    this.pending.set(orderAddress, o.state === OrderState.Delivered ? Number(o.releaseAt) : 0);
    this.quotes.delete(orderAddress);
    this.fulfilled.set(orderAddress, { f, claim: quote.claim, client: quote.client, proof, at: Date.now() });
    for (const k of this.fulfilled.keys()) {
      if (this.fulfilled.size <= 2000) break;
      this.fulfilled.delete(k);
    }
    this.save();
    return f;
  }

  /**
   * An order past delivery whose result this process does not hold (it
   * crashed or restarted between the delivery and the answer): rebuild the
   * result from the evidence, if what is on file is what was committed.
   */
  private async recorded(orderAddress: string, quote: Quote, o: Order, proof: string, receipts: SettleResponse[] = []): Promise<Fulfilment | undefined> {
    if (![OrderState.Delivered, OrderState.Disputed, OrderState.Released, OrderState.Resolved].includes(o.state)) return undefined;
    const { match } = await this.evidenceFor(orderAddress, o.deliveryHash);
    if (!match) return undefined;
    return this.finish(orderAddress, quote, proof, {
      deliverable: match.deliverable,
      deliveryHash: toHex(o.deliveryHash),
      order: quote.terms.order,
      state: OrderState[o.state]!,
      instant: o.instant,
      releaseAt: Number(o.releaseAt),
      receipts,
      timings: {},
      deliverTx: '',
    }, o);
  }

  /** Work starts, and a delivery is sent, only with time to spare before the deadline. */
  private async beforeDeadline(o: Order, margin: bigint): Promise<void> {
    if ((await chainNow(this.ops)) >= o.deliverBy - margin) {
      throw new Error('too close to the delivery deadline to deliver safely');
    }
  }

  /**
   * A paid order this merchant will not deliver goes back to the buyer now,
   * while the merchant's own refund costs it nothing. `done` says the order is
   * off the merchant's hands (refunded, or delivered after all). If the refund
   * failed it is not, and the crank tries again before the deadline.
   */
  private async giveBack(
    orderAddress: string,
    quote: Quote,
    proof: string,
    receipts: SettleResponse[],
  ): Promise<{ done: boolean; note: string; delivered?: Fulfilment }> {
    const order = quote.terms.order;
    try {
      const o = await readOrder(this.ops, order);
      if (!o) return { done: true, note: '' };
      if (o.state !== OrderState.Funded) {
        // it landed after all: hand it over like any other
        const delivered = await this.recorded(orderAddress, quote, o, proof, receipts);
        if (!delivered && (o.state === OrderState.Delivered || o.state === OrderState.Disputed)) this.pending.set(orderAddress, Number(o.releaseAt));
        return { done: true, note: '', delivered };
      }
      await refund(this.signer, order, o);
      console.log(`[fulfil] ${order.slice(0, 8)}: not delivered; ${this.id} refunded the buyer`);
      return { done: true, note: '; the escrow was refunded to the buyer' };
    } catch (err) {
      console.warn(`[fulfil] ${order.slice(0, 8)}: refund failed (${(err as Error).message.slice(0, 120)}); the crank will retry`);
      return { done: false, note: '' };
    }
  }

  /**
   * One pass of upkeep, run by the crank. `funded` is every order the chain
   * shows as Funded; this takes the ones this merchant co-signed.
   *
   *  - Unpaid quotes past their payment window are cancelled (anything that
   *    reached the vault goes back to the buyer), and quotes whose order has
   *    moved on are forgotten. A quote is dropped only once the on-chain step
   *    that ends it has succeeded.
   *  - A funded order nobody is fulfilling (the buyer never called, the
   *    process restarted) is delivered if its request is on file, and
   *    refunded by the merchant, which costs it nothing, if it is not or
   *    there is too little time left. Nothing is left to expire.
   */
  async tend(funded: Decoded<Order>[]): Promise<void> {
    const cfg = await getConfig(this.ops);
    const now = await chainNow(this.ops);
    this.prune(cfg);
    for (const [order, q] of [...this.quotes]) {
      await this.tendQuote(order, q, cfg, now).catch((e) => this.failed(order, 'quote', e, q));
    }
    for (const { address: order, data: o } of funded) {
      if (o.merchant !== this.wallet) continue;
      await this.tendFunded(order, o, cfg, now).catch((e) => this.failed(order, 'funded order', e, this.quotes.get(order)));
    }
  }

  private failed(order: string, what: string, e: unknown, q?: Quote): void {
    console.warn(`[crank] ${this.id} ${what} ${order.slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`);
    if (q) {
      q.retryAt = Date.now() + 30_000;
      this.save();
    }
  }

  private async tendQuote(order: string, q: Quote, cfg: Config, now: bigint): Promise<void> {
    if (this.inflight.has(order) || (q.retryAt && Date.now() < q.retryAt)) return;
    if (Date.now() - q.openedAt < (cfg.params.unpaidSecs + 15) * 1000) return;
    const o = await readOrder(this.ops, q.terms.order);
    const drop = () => {
      this.quotes.delete(order);
      this.save();
    };
    if (!o) return drop();
    switch (o.state) {
      case OrderState.AwaitingPayment:
        if (now < o.createdAt + BigInt(cfg.params.unpaidSecs) + 15n) return;
        await cancelUnpaid(this.ops, q.terms.order, o);
        return drop();
      case OrderState.Funded:
        return; // tendFunded's
      case OrderState.Delivered:
      case OrderState.Disputed:
        this.pending.set(order, Number(o.releaseAt));
        break;
      case OrderState.Released:
      case OrderState.Resolved:
        if (!o.merchantReviewed) this.pending.set(order, 0);
        break;
      default:
        break; // Cancelled, Refunded
    }
    // delivered but never answered: keep the result for the holder of the claim
    if (!this.fulfilled.has(order)) await this.recorded(order, q, o, '');
    drop();
  }

  private async tendFunded(order: string, o: Order, cfg: Config, now: bigint): Promise<void> {
    if (this.behaviour === 'no-show' || this.inflight.has(order) || this.fulfilled.has(order)) return;
    const q = this.quotes.get(order);
    if (q?.retryAt && Date.now() < q.retryAt) return;
    const tooLate = now >= o.deliverBy - refundMargin(cfg);
    if (q && !q.doomed && !tooLate) {
      // give the buyer's own call the first go
      if (now < o.fundedAt + FULFIL_GRACE_SECS) return;
      await this.fulfil(order).catch((e) => console.warn(`[crank] ${this.id} ${order.slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`));
      return;
    }
    const back = await this.giveBack(order, q ?? stub(o, order), '', []);
    if (back.done && q) {
      this.quotes.delete(order);
      this.save();
    } else if (q) {
      q.retryAt = Date.now() + 15_000;
      this.save();
    }
  }

  /**
   * What an agent card says about this merchant's standing. Cards and the
   * agent list are public, so this is read from the chain at most every 30 s
   * however often they are asked for.
   */
  standing(): Promise<Standing> {
    if (!this.standingCache || Date.now() - this.standingCache.at > 30_000) {
      const value = readStanding(this);
      this.standingCache = { at: Date.now(), value };
      // a failed read is not kept
      value.catch(() => {
        if (this.standingCache?.value === value) this.standingCache = undefined;
      });
    }
    return this.standingCache.value;
  }
}

/** Just enough of a quote to refund an order this process has no quote for. */
const stub = (o: Order, order: string): Quote => ({
  sku: '',
  input: {},
  terms: { order: address(order), buyer: o.buyer } as EscrowTerms,
  required: { x402Version: 2, resource: { url: '' }, accepts: [] } as unknown as PaymentRequired,
  openedAt: 0,
  client: 'local',
});

/** Delete the evidence files' stale entries and report how many went. */
export const pruneEvidence = (cfg: Config): number => compactEvidence(cfg.params.complaintSecs);

export const requestHashHex = async (sku: string, input: unknown) => toHex(await hashOf({ sku, input }));
export { canonical, fromHex };
export type { Order };
