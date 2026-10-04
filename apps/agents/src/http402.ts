/**
 * The same purchase over plain HTTP 402, with no A2A involved: ask, get a
 * 402 that names an escrow, check the escrow on-chain, pay, ask again.
 *
 *   npm run buy:http -w @tessera/agents -- --buyer nova --merchant quill
 */
import { address } from '@solana/kit';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { fromHex, fromUnits, verifyOrderForPayment } from '@tessera/sdk';
import { AGENT_HOST, keyPath } from '../../../scripts/cast.js';
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
const url = `${AGENT_HOST}/agents/${merchant}/x402/${skill}?buyer=${buyer.identity.address}`;

// 1. Ask. The answer is 402 with the payment terms in a header.
const first = await fetch(url);
console.log(`GET ${url.replace(buyer.identity.address, '<buyer>')} -> ${first.status}`);
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${await first.text()}`);
const required = decodePaymentRequiredHeader(first.headers.get('PAYMENT-REQUIRED')!);
const option = required.accepts[0]!;
const terms = required.extensions!.tessera as EscrowTerms;
console.log(`402: pay ${fromUnits(BigInt(option.amount))} USDC to ${option.payTo} (hold ${terms.holdSecs}s)`);

// 2. Check on-chain that payTo is this order's escrow and the order is ours.
for (let i = 0; ; i += 1) {
  try {
    await verifyOrderForPayment(buyer.rpc, {
      orderId: fromHex(terms.orderId),
      buyer: buyer.identity.address,
      merchant: address(terms.merchant),
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
