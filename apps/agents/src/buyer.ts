/**
 * A buyer agent. It finds a merchant agent by its A2A card, asks for a
 * service, and pays over x402 -- but only after it has read the escrow from
 * the chain and checked every field itself. Then it checks what it was given
 * against the hash the merchant committed on-chain, and rates the merchant.
 *
 * Nothing here trusts the merchant's server: not for where the money goes,
 * not for how long it is held, not for what was delivered.
 */
import { randomUUID } from 'node:crypto';
import { address, type Address } from '@solana/kit';
import { x402Client } from '@x402/core/client';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { bytesEqual, fromHex, fromUnits, sha256, TIER_NAMES, verifyOrderForPayment, type Order } from '@tessera/sdk';
import { K, type Message, type Task } from './a2a.js';
import { liveScore, openDispute, OrderState, payDirect, readOrder, readUntil, release, submitReview, type Actor } from './chain.js';
import { TESSERA_EXTENSION_URI, X402_EXTENSION_URI } from './config.js';
import type { EscrowTerms } from './merchant.js';
import { canonical, hashOf } from './services.js';
import { sleep } from '../../../scripts/lib.js';

export type PayMode = 'x402' | 'direct';

export type Purchase = {
  merchant: string;
  merchantWallet: Address;
  skill: string;
  order: Address;
  terms: EscrowTerms;
  mode: PayMode;
  /** Present when the merchant delivered. */
  deliverable?: unknown;
  /** The delivery matches the hash committed on-chain. */
  verified: boolean;
  instant: boolean;
  releaseAt: number;
  receipts: SettleResponse[];
  /** Milliseconds, measured by the buyer. */
  timings: { quoteMs: number; verifyMs: number; payMs: number; totalMs: number; merchant?: Record<string, number> };
  failed?: string;
};

type Card = {
  name: string;
  url: string;
  capabilities?: { extensions?: { uri: string; required?: boolean; params?: Record<string, unknown> }[] };
};

export class BuyerAgent {
  constructor(
    readonly id: string,
    readonly actor: Actor,
    readonly opts: {
      rpcUrl: string;
      mode: PayMode;
      /** Pays the rent for this agent's review accounts. */
      sponsor?: Actor;
      /** Ask merchants below Established for at least this long a hold. */
      minHoldForUnknown?: number;
      log?: (line: string) => void;
    },
  ) {}

  get wallet(): Address {
    return this.actor.identity.address;
  }

  private log(line: string): void {
    this.opts.log?.(`[${this.id}] ${line}`);
  }

  private async rpc(url: string, params: Record<string, unknown>): Promise<Task> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-A2A-Extensions': X402_EXTENSION_URI },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'message/send', params }),
    });
    const body = (await res.json()) as { result?: Task; error?: { code: number; message: string } };
    if (body.error || !body.result) throw new Error(`A2A error: ${body.error?.message ?? res.status}`);
    return body.result;
  }

  /**
   * Buy one call of `skill` from the agent whose card is at `cardUrl`. The
   * price the card advertises is the most this buyer will pay, whatever the
   * quote says.
   */
  async buy(cardUrl: string, skill: string, input: unknown = {}, extra: { minHoldSecs?: number } = {}): Promise<Purchase> {
    const t0 = Date.now();

    // 1. Discover.
    const card = (await (await fetch(cardUrl)).json()) as Card;
    const exts = card.capabilities?.extensions ?? [];
    if (!exts.some((e) => e.uri === X402_EXTENSION_URI)) throw new Error(`${card.name} does not take x402 payments`);
    const tessera = exts.find((e) => e.uri === TESSERA_EXTENSION_URI)?.params ?? {};
    const merchantWallet = address(String(tessera.wallet));
    const advertised = BigInt(String((tessera.prices as Record<string, string> | undefined)?.[skill] ?? '0'));
    if (advertised === 0n) throw new Error(`${card.name} does not advertise a price for ${skill}`);

    // 2. Look the merchant up on-chain. The card's own claims are not used.
    const standing = await liveScore(this.actor, merchantWallet);
    const merchantTier = standing?.tier ?? 0;
    // A buyer can always ask for a longer hold than the tiers call for.
    const minHoldSecs = extra.minHoldSecs ?? (merchantTier < 2 ? this.opts.minHoldForUnknown : undefined);

    // 3. Ask.
    const ask: Message = {
      kind: 'message',
      role: 'user',
      messageId: randomUUID(),
      parts: [{ kind: 'data', data: { skill, input, buyer: this.wallet, ...(minHoldSecs ? { minHoldSecs } : {}) } }],
    };
    const quoted = await this.rpc(card.url, { message: ask });
    const meta = quoted.status.message?.metadata ?? {};
    if (quoted.status.state !== 'input-required' || meta[K.status] !== 'payment-required') {
      throw new Error(`expected a payment request, got ${quoted.status.state}`);
    }
    const required = meta[K.required] as PaymentRequired;
    const terms = (required.extensions?.tessera ?? meta[K.escrow]) as EscrowTerms;
    const quoteMs = Date.now() - t0;

    // 4. Verify the escrow on-chain before signing anything.
    const tVerify = Date.now();
    const option = required.accepts[0];
    if (!option) throw new Error('the quote offers no way to pay');
    const amount = BigInt(option.amount);
    if (amount > advertised) throw new Error(`quote of ${amount} is above the advertised price ${advertised}`);
    const expected = {
      orderId: fromHex(terms.orderId),
      buyer: this.wallet,
      merchant: merchantWallet,
      amount,
      mint: address(option.asset),
      payTo: address(option.payTo),
      requestHash: await hashOf({ sku: skill, input }),
      minHoldSecs,
    };
    // The merchant may have confirmed the order on a node a slot ahead of the
    // one this read lands on, so "not there yet" is retried. Nothing else is.
    let verified: Awaited<ReturnType<typeof verifyOrderForPayment>> | undefined;
    for (let attempt = 0; !verified; attempt += 1) {
      try {
        verified = await verifyOrderForPayment(this.actor.rpc, expected);
      } catch (e) {
        if (attempt >= 8 || !/does not exist/.test((e as Error).message)) throw e;
        await sleep(600);
      }
    }
    const verifyMs = Date.now() - tVerify;
    this.log(
      `${card.name}/${skill}: ${fromUnits(amount)} USDC into escrow ${verified.order.slice(0, 8)}, ` +
        `hold ${verified.data.holdSecs}s (merchant ${TIER_NAMES[verified.data.merchantTier]}, me ${TIER_NAMES[verified.data.buyerTier]}` +
        `${verified.data.pairTrusted ? ', pair trusted' : ''})`,
    );

    const base: Omit<Purchase, 'verified' | 'instant' | 'releaseAt' | 'receipts' | 'timings'> = {
      merchant: card.name,
      merchantWallet,
      skill,
      order: verified.order,
      terms,
      mode: this.opts.mode,
    };

    // 5. Pay, and hand the proof back on the same task.
    const tPay = Date.now();
    let done: Task;
    if (this.opts.mode === 'x402') {
      done = await this.payOverX402(card.url, quoted.id, required, verified.order, amount);
    } else {
      const signature = await payDirect(this.actor, verified.order, verified.data, verified.vault);
      done = await this.rpc(card.url, {
        message: {
          kind: 'message',
          role: 'user',
          messageId: randomUUID(),
          taskId: quoted.id,
          parts: [{ kind: 'text', text: 'Escrow funded.' }],
          metadata: { [K.status]: 'payment-submitted', [K.direct]: { signature } },
        } satisfies Message,
      });
    }
    const payMs = Date.now() - tPay;

    const doneMeta = done.status.message?.metadata ?? {};
    const receipts = (doneMeta[K.receipts] as SettleResponse[] | undefined) ?? [];
    if (done.status.state !== 'completed') {
      const why = `${doneMeta[K.error] ?? done.status.state}: ${done.status.message?.parts?.[0] && 'text' in done.status.message.parts[0] ? done.status.message.parts[0].text : ''}`;
      this.log(`${card.name}/${skill}: not delivered (${why.slice(0, 100)})`);
      return { ...base, verified: false, instant: false, releaseAt: 0, receipts, timings: { quoteMs, verifyMs, payMs, totalMs: Date.now() - t0 }, failed: why };
    }

    // 6. Check the delivery against the hash committed on-chain.
    const part = done.artifacts?.[0]?.parts?.[0];
    const deliverable = part && part.kind === 'data' ? part.data : undefined;
    const delivery = doneMeta[K.delivery] as { instant: boolean; releaseAt: number; timings?: Record<string, number> };
    const onChain = await readUntil(() => readOrder(this.actor, verified.order), (o) => o !== null && o.deliveredAt > 0n, 8);
    const matches = onChain !== null && deliverable !== undefined && bytesEqual(await sha256(canonical(deliverable)), onChain.deliveryHash);

    return {
      ...base,
      deliverable,
      verified: matches,
      instant: Boolean(delivery?.instant),
      releaseAt: Number(onChain?.releaseAt ?? 0),
      receipts,
      timings: { quoteMs, verifyMs, payMs, totalMs: Date.now() - t0, merchant: delivery?.timings },
    };
  }

  /** Sign an x402 payment for exactly the verified escrow and submit it. */
  private async payOverX402(url: string, taskId: string, required: PaymentRequired, order: Address, amount: bigint): Promise<Task> {
    let lastError = 'no payment option worked';
    for (const option of required.accepts) {
      const x402 = new x402Client();
      // The SDK ships a per-payment cap. Pin it to this order instead of lifting it.
      x402.setSpendControls({ maxAmountPerPayment: `$${fromUnits(amount, 6, 6)}` });
      x402.registerPolicy((_v, reqs) =>
        reqs.filter(
          (r) => r.payTo === order && BigInt(r.amount) === amount && r.asset === option.asset && r.extra?.feePayer === option.extra?.feePayer,
        ),
      );
      x402.register('solana:*', new ExactSvmScheme(this.actor.identity, { rpcUrl: this.opts.rpcUrl }));
      let payload: PaymentPayload;
      try {
        payload = await x402.createPaymentPayload({ ...required, accepts: [option] });
      } catch (e) {
        lastError = (e as Error).message;
        continue;
      }
      const task = await this.rpc(url, {
        message: {
          kind: 'message',
          role: 'user',
          messageId: randomUUID(),
          taskId,
          parts: [{ kind: 'text', text: 'Payment attached.' }],
          metadata: { [K.status]: 'payment-submitted', [K.payload]: payload },
        } satisfies Message,
      });
      return task;
    }
    throw new Error(lastError);
  }

  /**
   * What a careful agent does after a purchase: if the delivery does not
   * match and the hold is still running, dispute; otherwise wait for
   * settlement and leave a rating.
   */
  async followUp(p: Purchase, opts: { rating?: number; text?: string; disputeAnyway?: boolean } = {}): Promise<string> {
    const sponsor = this.opts.sponsor ?? this.actor;
    let o = await readOrder(this.actor, p.order);
    if (!o) return 'order closed';

    const bad = !p.verified || opts.disputeAnyway;
    if (bad && o.state === OrderState.Delivered && Date.now() / 1000 < Number(o.releaseAt) - 2) {
      await openDispute(this.actor, p.order, o, await sha256(opts.disputeAnyway ? 'I never received this' : 'delivery does not match its hash'));
      this.log(`${p.merchant}: disputed ${p.order.slice(0, 8)}`);
      o = await this.waitFor(p.order, (x) => x.state === OrderState.Resolved, 90);
    } else {
      // Nothing to see until the hold ends (or, for a no-show, the delivery deadline).
      const wake = o.state === OrderState.Funded ? Number(o.deliverBy) : Number(o.releaseAt);
      await sleep(Math.max(0, wake * 1000 + 9000 - Date.now()));
      o = await this.waitFor(p.order, (x) => [OrderState.Released, OrderState.Refunded, OrderState.Resolved].includes(x.state), 120);
    }
    if (!o || o.buyerReviewed) return o ? OrderState[o.state]! : 'unknown';
    if (![OrderState.Released, OrderState.Refunded, OrderState.Resolved].includes(o.state)) return OrderState[o.state]!;

    const rating = opts.rating ?? (o.state === OrderState.Refunded ? 1 : p.verified ? 5 : 1);
    const text = opts.text ?? (o.state === OrderState.Refunded ? 'Paid, nothing delivered. Refunded by the escrow.' : p.verified ? 'Delivered what was asked. Hash matches.' : 'Delivery did not match its on-chain hash.');
    await submitReview(this.actor, sponsor, p.order, o, rating, text);
    return OrderState[o.state]!;
  }

  /** Confirm receipt early instead of waiting out the hold. */
  async confirmReceipt(p: Purchase): Promise<void> {
    const o = await readOrder(this.actor, p.order);
    if (o && o.state === OrderState.Delivered) await release(this.actor, p.order, o);
  }

  private async waitFor(order: Address, done: (o: Order) => boolean, seconds: number): Promise<Order | null> {
    const until = Date.now() + seconds * 1000;
    for (;;) {
      const o = await readOrder(this.actor, order);
      if (!o || done(o) || Date.now() > until) return o;
      await sleep(5000);
    }
  }
}
