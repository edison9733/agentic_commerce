/**
 * Which of a wallet's orders it can still review. Pure functions over the
 * decoded order accounts the store already holds, so the Review page can list
 * them without another RPC read.
 */
import { OrderState, type Order } from '@tessera/sdk';
import type { Address } from '@solana/kit';
import { duration } from './format';

export const SETTLED = [OrderState.Released, OrderState.Refunded, OrderState.Resolved];

/** One of a wallet's orders, with what this wallet can still do about it. */
export type Mine = {
  address: Address;
  order: Order;
  side: 'buyer' | 'merchant';
  /** This side has already reviewed the order. */
  done: boolean;
  settled: boolean;
  /** When the review window closes, once the order has settled and the config is known. */
  closesAt: number | null;
  /** The window is still open. */
  open: boolean;
};

/** A wallet's orders: the ones it can still review first, then unsettled ones, then the rest, newest first. */
export function ordersOf(orders: { address: Address; data: Order }[], wallet: Address, reviewSecs: number | null, now: number): Mine[] {
  const rank = (m: Mine) => (m.open && !m.done ? 0 : !m.settled ? 1 : 2);
  const when = (o: Order) => Number(o.settledAt || o.createdAt);
  return orders
    .filter(({ data: o }) => o.buyer === wallet || o.merchant === wallet)
    .map(({ address, data: o }): Mine => {
      const side = o.buyer === wallet ? 'buyer' : 'merchant';
      const settled = SETTLED.includes(o.state);
      const closesAt = settled && reviewSecs !== null ? Number(o.settledAt) + reviewSecs : null;
      return { address, order: o, side, done: side === 'buyer' ? o.buyerReviewed : o.merchantReviewed, settled, closesAt, open: closesAt !== null && closesAt > now };
    })
    .sort((a, b) => rank(a) - rank(b) || when(b.order) - when(a.order));
}

/** Time left in a review window, in words. */
export function left(secs: number): string {
  if (secs <= 0) return 'closed';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ${String(Math.floor(secs % 60)).padStart(2, '0')} s`;
  return duration(Math.floor(secs));
}

export function windowText(m: Mine, now: number): string {
  if (!m.settled) return 'not settled yet';
  if (m.closesAt === null) return 'reading the config…';
  return m.closesAt > now ? `${left(m.closesAt - now)} left to review` : 'review window closed';
}
