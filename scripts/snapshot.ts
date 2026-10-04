/**
 * Read the demo network's state from devnet and the measured timings from
 * disk, write deployments/snapshot.json, and refresh the table in the README.
 * Every figure the docs quote about the live network comes from here.
 *
 *   npm run snapshot
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configPda,
  fetchAllAgents,
  fetchAllOrders,
  fetchAllPairs,
  fetchAllReviews,
  fetchConfig,
  fromUnits,
  OrderState,
  score,
  TIER_NAMES,
} from '@tessera/sdk';
import { chainTime, clientForSigner, generateKeypairBytes, REPO_ROOT } from './lib.js';

const c = clientForSigner((await generateKeypairBytes()).signer);
const rpc = c.rpc as never;
const config = (await fetchConfig(c.rpc, await configPda())).data;
const [agents, orders, pairs, reviews, now] = [await fetchAllAgents(rpc), await fetchAllOrders(rpc), await fetchAllPairs(rpc), await fetchAllReviews(rpc), await chainTime(c)];

const rows = agents
  .map((a) => {
    const e = score.evaluate(a.data, config.params, now);
    return {
      name: a.data.name || `${a.data.wallet.slice(0, 4)}…`,
      wallet: a.data.wallet,
      role: a.data.asMerchant.orders || a.data.uri ? 'merchant' : 'buyer',
      score: e.score,
      tier: TIER_NAMES[e.tier],
      orders: a.data.asMerchant.orders + a.data.asBuyer.orders,
      stars: Math.round(score.averageStars(a.data, config.params) * 100) / 100,
      disputesLost: a.data.asMerchant.disputesLost + a.data.asBuyer.disputesLost,
      missedDeliveries: a.data.asMerchant.expired,
      penaltyPct: score.currentPenalty(a.data, config.params, now) / 100n,
    };
  })
  .sort((x, y) => y.score - x.score);

const count = (s: OrderState) => orders.filter((o) => o.data.state === s).length;
const released = orders.filter((o) => o.data.state === OrderState.Released);
const median = (xs: number[]) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)]! : null;
};

type M = { mode: string; instant: boolean; totalMs: number; quoteMs: number; verifyMs: number; payMs: number; merchant?: Record<string, number> };
const file = resolve(REPO_ROOT, 'deployments/measurements.jsonl');
const ms: M[] = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as M) : [];
const x402 = ms.filter((m) => m.mode === 'x402');

const snapshot = {
  takenAt: new Date(Number(now) * 1000).toISOString(),
  cluster: 'devnet',
  ordersOpened: Number(config.ordersOpened),
  ordersSettled: Number(config.ordersSettled),
  volumeSettledUsdc: fromUnits(config.volumeSettled),
  feesCollectedUsdc: fromUnits(config.feesCollected, 6, 4),
  agents: agents.length,
  tiers: Object.fromEntries(TIER_NAMES.map((t) => [t, rows.filter((r) => r.tier === t).length])),
  pairs: pairs.length,
  reviewsOnChain: reviews.length,
  settledInstantly: released.filter((o) => o.data.instant).length,
  settledAfterHold: released.filter((o) => !o.data.instant).length,
  refunded: count(OrderState.Refunded),
  disputesResolved: count(OrderState.Resolved),
  measured: {
    purchases: ms.length,
    viaFacilitator: x402.length,
    facilitatorVerifyMsMedian: median(x402.map((m) => m.merchant?.verifyMs ?? NaN)),
    facilitatorSettleMsMedian: median(x402.map((m) => m.merchant?.settleMs ?? NaN)),
    buyerEndToEndMsMedianViaFacilitator: median(x402.map((m) => m.totalMs)),
    buyerEndToEndMsMedianDirect: median(ms.filter((m) => m.mode === 'direct').map((m) => m.totalMs)),
  },
  agentsByScore: rows.map((r) => ({ ...r, penaltyPct: Number(r.penaltyPct) })),
};
writeFileSync(resolve(REPO_ROOT, 'deployments/snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');

const s = snapshot;
const md = [
  `Snapshot of the demo network at ${s.takenAt} (\`deployments/snapshot.json\`):`,
  '',
  '| | |',
  '|---|---|',
  `| Orders settled through escrow | ${s.ordersSettled} of ${s.ordersOpened} opened, ${s.volumeSettledUsdc} USDC, ${s.feesCollectedUsdc} USDC in fees |`,
  `| Settled instantly / after a hold | ${s.settledInstantly} / ${s.settledAfterHold} |`,
  `| Refunded / disputes resolved by the arbiter | ${s.refunded} / ${s.disputesResolved} |`,
  `| Credit files | ${s.agents}: ${TIER_NAMES.map((t) => `${s.tiers[t]} ${t}`).join(', ')} |`,
  `| Reviews stored on-chain | ${s.reviewsOnChain} |`,
  `| Purchases timed | ${s.measured.purchases}, of which ${s.measured.viaFacilitator} paid through an x402 facilitator |`,
  `| Facilitator verify / settle, median | ${s.measured.facilitatorVerifyMsMedian} ms / ${s.measured.facilitatorSettleMsMedian} ms |`,
  `| Whole purchase as the buyer sees it, median | ${((s.measured.buyerEndToEndMsMedianViaFacilitator ?? 0) / 1000).toFixed(1)} s via facilitator, ${((s.measured.buyerEndToEndMsMedianDirect ?? 0) / 1000).toFixed(1)} s direct |`,
  '',
  'The whole-purchase time is five sequential transactions on a rate-limited public RPC shared with',
  'the rest of the demo. It measures this prototype on that endpoint, not Solana.',
  '',
  '| Agent | Role | Tier | Score | Orders | Stars | Note |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.role} | ${r.tier} | ${r.score} | ${r.orders} | ${r.stars} | ${[r.disputesLost ? `${r.disputesLost} dispute(s) lost` : '', r.missedDeliveries ? `${r.missedDeliveries} missed deliveries` : '', r.penaltyPct ? `${r.penaltyPct}% penalty` : ''].filter(Boolean).join(', ')} |`),
].join('\n');

const readme = resolve(REPO_ROOT, 'README.md');
const text = readFileSync(readme, 'utf8');
writeFileSync(readme, text.replace(/<!-- snapshot:start -->[\s\S]*<!-- snapshot:end -->/, `<!-- snapshot:start -->\n${md}\n<!-- snapshot:end -->`));
console.log(md);
