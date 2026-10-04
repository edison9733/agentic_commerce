/**
 * A merchant agent: quotes a price by opening an escrow, and once the escrow
 * is funded does the work, commits a hash of it on-chain and hands it over.
 */
import { address, type Address } from '@solana/kit';
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { fromHex, fromUnits, score, TESSERA_PROGRAM_ADDRESS, TIER_NAMES, toHex, type Order } from '@tessera/sdk';
import {
  confirmFunded,
  deliver,
  getConfig,
  openOrder,
  OrderState,
  readAgent,
  readOrder,
  readUntil,
  vaultBalance,
  type Actor,
} from './chain.js';
import { config } from './config.js';
import { facilitators, verifyAndSettle } from './facilitator.js';
import { canonical, hashOf, SERVICES, type Service } from './services.js';

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

export type Behaviour = 'honest' | 'no-show' | 'junk';

export class MerchantAgent {
  /** Orders this merchant quoted, by order address. */
  readonly quotes = new Map<string, Quote>();
  /** What was delivered, kept so the arbiter can check a dispute. */
  readonly deliveries = new Map<string, { sku: string; deliverable: unknown }>();
  /** Orders to look at again, and the chain time from which to look (their release time). */
  readonly pending = new Map<string, number>();
  readonly services: Service[];

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
  }

  get wallet(): Address {
    return this.signer.identity.address;
  }

  service(sku: string): Service {
    const s = this.services.find((x) => x.sku === sku);
    if (!s) throw new Error(`${this.id} does not sell "${sku}"`);
    return s;
  }

  unpaidFor(buyer: Address): number {
    let n = 0;
    for (const q of this.quotes.values()) if (q.terms.buyer === buyer) n += 1;
    return n;
  }

  /**
   * Quote: open an escrow for this buyer and describe how to fund it. The
   * x402 `payTo` is the order account itself, so a spec-compliant payment
   * lands in escrow with no custom scheme.
   */
  async quote(req: { buyer: string; sku: string; input?: unknown; minHoldSecs?: number; resourceUrl: string }): Promise<Quote> {
    const buyer = address(req.buyer);
    const service = this.service(req.sku);
    if (this.unpaidFor(buyer) >= config.maxUnpaidPerBuyer) {
      throw new Error('too many unpaid orders for this wallet; pay or wait for them to expire');
    }
    const input = req.input ?? {};
    const requestHash = await hashOf({ sku: service.sku, input });
    const opened = await openOrder(this.ops, {
      buyer,
      merchant: this.wallet,
      amount: service.price,
      requestHash,
      minHoldSecs: req.minHoldSecs,
    });
    const d = opened.data;
    const cfg = await getConfig(this.ops);
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
    const quote: Quote = { sku: service.sku, input, terms, required, openedAt: Date.now() };
    this.quotes.set(opened.order, quote);
    return quote;
  }

  /**
   * Fund (through a facilitator, if a signed x402 payment was handed over),
   * prove funding on-chain, do the work, commit it, deliver it.
   */
  async fulfil(orderAddress: string, payment?: PaymentPayload): Promise<Fulfilment> {
    const quote = this.quotes.get(orderAddress);
    if (!quote) throw new Error('unknown or already fulfilled order');
    const order = quote.terms.order;
    const timings: Record<string, number> = {};
    const receipts: SettleResponse[] = [];
    const t0 = Date.now();

    if (payment) {
      const accepted = quote.required.accepts.find(
        (a) => a.payTo === payment.accepted.payTo && a.extra?.feePayer === payment.accepted.extra?.feePayer,
      );
      if (!accepted || payment.accepted.amount !== accepted.amount || payment.accepted.asset !== accepted.asset) {
        throw new Error('payment does not match any option that was quoted');
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
      const t = Date.now();
      await confirmFunded(this.ops, order, o.mint);
      timings.confirmMs = Date.now() - t;
      o = (await readUntil(() => readOrder(this.ops, order), (x) => x !== null && x.state !== OrderState.AwaitingPayment))!;
    }
    if (o.state !== OrderState.Funded) throw new Error(`order is ${OrderState[o.state]}, not Funded`);
    this.quotes.delete(orderAddress);

    if (this.behaviour === 'no-show') {
      // Takes the order and goes quiet. The buyer is refunded at the deadline.
      throw new Error('merchant did not deliver');
    }

    const service = this.service(quote.sku);
    const tWork = Date.now();
    const deliverable = await service.run(quote.input, { actor: this.signer });
    timings.workMs = Date.now() - tWork;

    const deliveryHash = await hashOf(deliverable);
    const tDeliver = Date.now();
    const { signature, instant } = await deliver(this.signer, order, o, deliveryHash);
    timings.deliverMs = Date.now() - tDeliver;
    timings.totalMs = Date.now() - t0;

    this.deliveries.set(order, { sku: quote.sku, deliverable });
    const after = (await readUntil(() => readOrder(this.ops, order), (x) => x !== null && x.state !== OrderState.Funded))!;
    // Held orders are cranked when the hold ends; instant ones are just rated.
    this.pending.set(order, after.state === OrderState.Delivered ? Number(after.releaseAt) : 0);
    return {
      deliverable,
      deliveryHash: toHex(deliveryHash),
      order,
      state: OrderState[after.state]!,
      instant,
      releaseAt: Number(after.releaseAt),
      receipts,
      timings,
      deliverTx: signature,
    };
  }

  /** What an agent card says about this merchant's standing, read live. */
  async standing() {
    const [me, cfg] = await Promise.all([readAgent(this.ops, this.wallet), getConfig(this.ops)]);
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
}

export const requestHashHex = async (sku: string, input: unknown) => toHex(await hashOf({ sku, input }));
export { canonical, fromHex };
export type { Order };
