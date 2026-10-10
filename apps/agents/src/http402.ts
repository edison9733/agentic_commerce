/**
 * The same purchase over plain HTTP 402, with no A2A involved: ask, get a
 * 402 that names an escrow, check the escrow on-chain, pay, ask again.
 *
 *   npm run buy:http -w @tessera/agents -- --buyer nova --merchant quill [--max 0.30]
 *
 * It pays no more than the price the merchant's agent card advertises (or
 * --max, if lower), and only into the escrow of the order it verified.
 */
import { address } from '@solana/kit';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { fromHex, fromUnits, toUnits, verifyOrderForPayment } from '@tessera/sdk';
import { AGENT_HOST, keyPath } from '../../../scripts/cast.js';
import { TESSERA_EXTENSION_URI } from './config.js';
import { clientForSigner, explorerTx, loadKeypair, localRpcProxy } from '../../../scripts/lib.js';
import type { EscrowTerms } from './merchant.js';
import { hashOf, SERVICES } from './services.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const merchant = arg('merchant', 'quill');
const skill = arg('skill', SERVICES[merchant]![0]!.sku);
const buyer = clientForSigner(await loadKeypair(keyPath(arg('buyer', 'nova'))));
const maxArg = arg('max', '');
const url = `${AGENT_HOST}/agents/${merchant}/x402/${skill}?buyer=${buyer.identity.address}`;

// 0. The most this buyer will pay: what the merchant's card advertises, and --max if lower.
const card = (await (await fetch(`${AGENT_HOST}/agents/${merchant}/.well-known/agent-card.json`)).json()) as {
  capabilities?: { extensions?: { uri: string; params?: Record<string, unknown> }[] };
};
const tessera = card.capabilities?.extensions?.find((e) => e.uri === TESSERA_EXTENSION_URI)?.params ?? {};
const advertised = BigInt(String((tessera.prices as Record<string, string> | undefined)?.[skill] ?? '0'));
if (advertised === 0n) throw new Error(`${merchant} does not advertise a price for ${skill}`);
const ceiling = maxArg && toUnits(maxArg) < advertised ? toUnits(maxArg) : advertised;
const merchantWallet = address(String(tessera.wallet));

// 1. Ask. The answer is 402 with the payment terms in a header.
const first = await fetch(url);
console.log(`GET ${url.replace(buyer.identity.address, '<buyer>')} -> ${first.status}`);
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${await first.text()}`);
const required = decodePaymentRequiredHeader(first.headers.get('PAYMENT-REQUIRED')!);
const option = required.accepts[0]!;
const terms = required.extensions!.tessera as EscrowTerms;
if (BigInt(option.amount) > ceiling) {
  throw new Error(`refusing to pay: the 402 asks ${fromUnits(BigInt(option.amount))} USDC, more than the ${fromUnits(ceiling)} this buyer allows`);
}
console.log(`402: pay ${fromUnits(BigInt(option.amount))} USDC to ${option.payTo} (hold ${terms.holdSecs}s)`);

// 2. Check on-chain that payTo is this order's escrow and the order is ours.
for (let i = 0; ; i += 1) {
  try {
    await verifyOrderForPayment(buyer.rpc, {
      orderId: fromHex(terms.orderId),
      buyer: buyer.identity.address,
      merchant: merchantWallet,
      amount: BigInt(option.amount),
      mint: address(option.asset),
      payTo: address(option.payTo),
      requestHash: await hashOf({ sku: skill, input: {} }),
    });
    break;
  } catch (e) {
    if (i >= 8 || !/does not exist/.test((e as Error).message)) throw e;
    await new Promise((r) => setTimeout(r, 600));
  }
}
console.log('escrow verified on-chain');

// 3. Sign the payment and ask again with it attached.
const x402 = new x402Client();
x402.setSpendControls({ maxAmountPerPayment: `$${fromUnits(BigInt(option.amount), 6, 6)}` });
// Only the order that was verified above: its address, amount and asset.
x402.registerPolicy((_v, reqs) => reqs.filter((r) => r.payTo === option.payTo && r.amount === option.amount && r.asset === option.asset));
x402.register('solana:*', new ExactSvmScheme(buyer.identity, { rpcUrl: await localRpcProxy() }));
const payload = await x402.createPaymentPayload({ ...required, accepts: [option] });
const second = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) } });
const body = (await second.json()) as { result?: unknown; escrow?: Record<string, unknown>; error?: string };
console.log(`GET with PAYMENT-SIGNATURE -> ${second.status}`);
if (!second.ok) throw new Error(body.error ?? 'failed');
const receipt = second.headers.get('PAYMENT-RESPONSE');
if (receipt) console.log(`settled: ${explorerTx(decodePaymentResponseHeader(receipt).transaction)}`);
console.log(`result: ${JSON.stringify(body.result).slice(0, 160)}`);
console.log(`escrow: ${JSON.stringify(body.escrow)}`);
process.exit(0);
