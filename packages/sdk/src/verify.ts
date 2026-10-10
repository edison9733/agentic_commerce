/**
 * What a buyer checks before it signs a payment.
 *
 * A merchant agent opens the order and quotes its address as the x402
 * `payTo`. The buyer must not take that on trust: a dishonest or compromised
 * merchant server could quote an order that names someone else as the buyer
 * (and refund itself), a different amount, or no escrow at all. So the buyer
 * re-derives the address from the order id, reads the account from the chain,
 * and refuses unless every field is what it asked for.
 */
import { fetchEncodedAccount, type Address } from '@solana/kit';
import { MAX_HOLD_SECS } from './constants.js';
import { fetchMaybeOrder, type Order } from './generated/accounts/order.js';
import { OrderState } from './generated/types/orderState.js';
import { TESSERA_PROGRAM_ADDRESS } from './generated/programs/tessera.js';
import { orderAddresses, reviewPdaOf } from './pda.js';
import { bytesEqual } from './util.js';

export type ExpectedOrder = {
  orderId: Uint8Array;
  buyer: Address;
  merchant: Address;
  amount: bigint;
  mint: Address;
  /** The address the 402 response quoted as `payTo`. */
  payTo: Address;
  requestHash?: Uint8Array;
  /** Refuse an order that would hold the money for less than this. */
  minHoldSecs?: number;
  /** Refuse an order that would hold the money for longer than this. */
  maxHoldSecs?: number;
};

export class OrderVerificationError extends Error {
  constructor(public readonly field: string, detail: string) {
    super(`refusing to pay: ${field} ${detail}`);
    this.name = 'OrderVerificationError';
  }
}

export type VerifiedOrder = { order: Address; vault: Address; data: Order };

type Rpc = Parameters<typeof fetchMaybeOrder>[0];

export async function verifyOrderForPayment(
  rpc: Rpc,
  expected: ExpectedOrder,
  programAddress: Address = TESSERA_PROGRAM_ADDRESS,
): Promise<VerifiedOrder> {
  const { order, vault } = await orderAddresses(expected.orderId, expected.mint, { programAddress });
  if (expected.payTo !== order) {
    throw new OrderVerificationError('payTo', `is ${expected.payTo}, but this order's escrow is ${order}`);
  }

  const account = await fetchMaybeOrder(rpc, order);
  if (!account.exists) throw new OrderVerificationError('order', 'does not exist on-chain');
  if (account.programAddress !== programAddress) {
    throw new OrderVerificationError('order', 'is not owned by the Tessera program');
  }
  const d = account.data;

  if (!bytesEqual(d.orderId, expected.orderId)) throw new OrderVerificationError('orderId', 'does not match');
  if (d.buyer !== expected.buyer) throw new OrderVerificationError('buyer', `is ${d.buyer}, not this wallet`);
  if (d.merchant !== expected.merchant) {
    throw new OrderVerificationError('merchant', `is ${d.merchant}, expected ${expected.merchant}`);
  }
  if (d.amount !== expected.amount) {
    throw new OrderVerificationError('amount', `is ${d.amount}, expected ${expected.amount}`);
  }
  if (d.mint !== expected.mint) throw new OrderVerificationError('mint', `is ${d.mint}`);
  if (d.state !== OrderState.AwaitingPayment) {
    throw new OrderVerificationError('state', `is ${OrderState[d.state]}, not AwaitingPayment`);
  }
  if (expected.requestHash && !bytesEqual(d.requestHash, expected.requestHash)) {
    throw new OrderVerificationError('requestHash', 'does not match what was asked for');
  }
  if (expected.minHoldSecs !== undefined && d.holdSecs < expected.minHoldSecs) {
    throw new OrderVerificationError('hold', `is ${d.holdSecs}s, this buyer requires ${expected.minHoldSecs}s`);
  }
  const maxHold = expected.maxHoldSecs ?? MAX_HOLD_SECS;
  if (d.holdSecs > maxHold) {
    throw new OrderVerificationError('hold', `is ${d.holdSecs}s, longer than the ${maxHold}s this buyer accepts`);
  }
  // Reviews are keyed by the order's address. An id the merchant already used
  // with this buyer, and closed, would leave this buyer unable to review the
  // new order -- and so unable to complain about an instant one.
  const review = await fetchEncodedAccount(rpc, await reviewPdaOf(order, expected.buyer, { programAddress }));
  if (review.exists) {
    throw new OrderVerificationError('orderId', 'was used before, and this wallet already reviewed that order');
  }
  return { order, vault, data: d };
}
