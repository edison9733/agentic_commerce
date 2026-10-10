/**
 * Everything the site shows comes from here, and everything here comes from
 * the chain: five `getProgramAccounts` reads, decoded in the browser, polled.
 * There is no indexer and no API between this page and the program.
 */
import { useSyncExternalStore } from 'react';
import {
  configPda,
  fetchAllAgents,
  fetchAllOrders,
  fetchAllPairs,
  fetchAllReviews,
  fetchMaybeConfig,
  OrderState,
  safeText,
  score,
  type Agent,
  type Config,
  type Decoded,
  type Evaluation,
  type Order,
  type Pair,
  type Params,
  type Review,
} from '@tessera/sdk';
import { readRpc } from './client';

export type FeedEvent = {
  id: string;
  at: number;
  kind: 'opened' | 'funded' | 'delivered' | 'released' | 'instant' | 'refunded' | 'disputed' | 'resolved';
  order: string;
  buyer: string;
  merchant: string;
  amount: bigint;
  holdSecs: number;
};

export type Snapshot = {
  status: 'loading' | 'live' | 'error';
  error?: string;
  loadedAt: number;
  config: Config | null;
  agents: Decoded<Agent>[];
  pairs: Decoded<Pair>[];
  orders: Decoded<Order>[];
  reviews: Decoded<Review>[];
  feed: FeedEvent[];
};

type Shared = { __tesseraSnap?: Snapshot };

/**
 * A deck slide shows the site in a same-origin iframe. That page starts from
 * what the deck has already read, instead of reading devnet again from
 * scratch while the slide is on screen. It keeps polling as usual.
 */
function fromParent(): Snapshot | null {
  try {
    if (window.parent === window) return null;
    const s = (window.parent as unknown as Shared).__tesseraSnap;
    return s?.config ? s : null;
  } catch {
    return null;
  }
}

let snap: Snapshot = fromParent() ?? { status: 'loading', loadedAt: 0, config: null, agents: [], pairs: [], orders: [], reviews: [], feed: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<Snapshot>) => {
  snap = { ...snap, ...patch };
  (window as unknown as Shared).__tesseraSnap = snap;
  emit();
};

const KIND: Record<number, FeedEvent['kind']> = {
  [OrderState.AwaitingPayment]: 'opened',
  [OrderState.Funded]: 'funded',
  [OrderState.Delivered]: 'delivered',
  [OrderState.Released]: 'released',
  [OrderState.Refunded]: 'refunded',
  [OrderState.Disputed]: 'disputed',
  [OrderState.Resolved]: 'resolved',
};

const lastState = new Map<string, number>(snap.orders.map((o) => [o.address, o.data.state]));
let primed = snap.status === 'live';

function diff(orders: Decoded<Order>[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const { address, data: o } of orders) {
    const before = lastState.get(address);
    lastState.set(address, o.state);
    // An abandoned quote is not news.
    if (!primed || before === o.state || o.state === OrderState.Cancelled) continue;
    const kind = o.state === OrderState.Released && o.instant ? 'instant' : KIND[o.state]!;
    out.push({
      id: `${address}:${o.state}`,
      at: Date.now() / 1000,
      kind,
      order: address,
      buyer: o.buyer,
      merchant: o.merchant,
      amount: o.amount,
      holdSecs: o.holdSecs,
    });
  }
  return out;
}

/** The latest thing that happened to each order, for a first paint with history in it. */
function seed(orders: Decoded<Order>[]): FeedEvent[] {
  return orders
    .filter(({ data: o }) => o.state !== OrderState.Cancelled)
    .map(({ address, data: o }) => {
      const at = Number(o.settledAt || o.deliveredAt || o.fundedAt || o.createdAt);
      const kind = o.state === OrderState.Released && o.instant ? 'instant' : KIND[o.state]!;
      return { id: `${address}:${o.state}`, at, kind, order: address, buyer: o.buyer, merchant: o.merchant, amount: o.amount, holdSecs: o.holdSecs } satisfies FeedEvent;
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 40);
}

let tick = 0;
let running = false;

async function load(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const slow = tick % 2 === 0 || !primed;
    tick += 1;
    const rpc = readRpc as never;
    const orders = await fetchAllOrders(rpc);
    const patch: Partial<Snapshot> = { orders, status: 'live', error: undefined, loadedAt: Date.now() };
    if (slow) {
      const [agents, pairs, reviews, config] = await Promise.all([
        fetchAllAgents(rpc),
        fetchAllPairs(rpc),
        fetchAllReviews(rpc),
        fetchMaybeConfig(readRpc, await configPda()),
      ]);
      Object.assign(patch, { agents, pairs, reviews, config: config.exists ? config.data : null });
    }
    const fresh = diff(orders);
    patch.feed = primed ? [...fresh, ...snap.feed].slice(0, 60) : seed(orders);
    primed = true;
    set(patch);
  } catch (e) {
    set({ status: snap.loadedAt ? 'live' : 'error', error: (e as Error).message });
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!timer) {
    void load();
    timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 6000);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export const useChain = (): Snapshot => useSyncExternalStore(subscribe, () => snap);
export const refresh = () => load();

export type Profile = {
  address: string;
  wallet: string;
  name: string;
  agent: Agent;
  eval: Evaluation;
  stars: number;
  volume: bigint;
  orders: number;
  role: 'merchant' | 'buyer' | 'both' | 'new';
};

/** A wallet's score as of now, recomputed in the browser from its account. */
export function profileOf(a: Decoded<Agent>, params: Params, now = Date.now() / 1000): Profile {
  const d = a.data;
  const e = score.evaluate(d, params, BigInt(Math.floor(now)));
  const sold = d.asMerchant.orders;
  const bought = d.asBuyer.orders;
  return {
    address: a.address,
    wallet: d.wallet,
    name: safeText(d.name, 32) || `${d.wallet.slice(0, 4)}…${d.wallet.slice(-4)}`,
    agent: d,
    eval: e,
    stars: score.averageStars(d, params),
    volume: d.asMerchant.volume + d.asBuyer.volume,
    orders: sold + bought,
    role: sold && bought ? 'both' : sold || d.uri ? 'merchant' : bought ? 'buyer' : 'new',
  };
}

export function useProfiles(): { profiles: Profile[]; byWallet: Map<string, Profile>; params: Params | null } {
  const { agents, config } = useChain();
  if (!config) return { profiles: [], byWallet: new Map(), params: null };
  const profiles = agents.map((a) => profileOf(a, config.params)).sort((x, y) => y.eval.score - x.eval.score);
  return { profiles, byWallet: new Map(profiles.map((p) => [p.wallet, p])), params: config.params };
}
