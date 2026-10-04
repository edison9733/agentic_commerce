/**
 * One purchase, start to finish, by one buyer agent.
 *
 *   npm run buy -w @tessera/agents -- --buyer scout --merchant atlas --skill telemetry --mode x402
 */
import { fromUnits } from '@tessera/sdk';
import { agentCardUrl, keyPath } from '../../../scripts/cast.js';
import { clientForSigner, explorerAddress, explorerTx, loadKeypair, localRpcProxy } from '../../../scripts/lib.js';
import { BuyerAgent, type PayMode } from './buyer.js';
import { SERVICES } from './services.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const buyerId = arg('buyer', 'scout');
const merchant = arg('merchant', 'atlas');
const skill = arg('skill', SERVICES[merchant]?.[0]?.sku ?? 'telemetry');
const mode = arg('mode', 'x402') as PayMode;
const input = JSON.parse(arg('input', '{}'));

const X402_RPC = process.env.X402_RPC_URL ?? (await localRpcProxy());

const buyer = new BuyerAgent(buyerId, clientForSigner(await loadKeypair(keyPath(buyerId))), {
  // The x402 client makes its own RPC calls; send them through the same budgeted pool.
  rpcUrl: X402_RPC,
  mode,
  sponsor: clientForSigner(await loadKeypair('.keys/server.json')),
  log: console.log,
});

const p = await buyer.buy(agentCardUrl(merchant), skill, input);
console.log(`\norder      ${explorerAddress(p.order)}`);
console.log(`amount     ${fromUnits(BigInt(p.terms.amount))} USDC, paid via ${p.mode === 'x402' ? 'x402 facilitator (buyer paid no SOL)' : 'a direct transfer'}`);
for (const r of p.receipts) console.log(`settle tx  ${explorerTx(r.transaction)}`);
if (p.failed) console.log(`FAILED     ${p.failed}`);
else {
  console.log(`delivered  ${JSON.stringify(p.deliverable).slice(0, 160)}`);
  console.log(`hash check ${p.verified ? 'matches the hash committed on-chain' : 'DOES NOT MATCH'}`);
  console.log(`settlement ${p.instant ? 'instant' : `held until ${new Date(p.releaseAt * 1000).toISOString()} (${p.terms.holdSecs}s)`}`);
}
console.log(`timings ms ${JSON.stringify(p.timings)}`);
console.log(`\nwaiting for settlement, then leaving a review...`);
console.log(`final      ${await buyer.followUp(p)}`);
process.exit(0);
