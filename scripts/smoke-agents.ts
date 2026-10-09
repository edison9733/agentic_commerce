/**
 * Smoke test of the merchant and buyer agents against the real program on a
 * local validator, without the network or the facilitators: a merchant
 * quotes (co-signing the order), a buyer pays the escrow directly, the
 * merchant delivers and keeps its evidence, the crank releases, and both
 * sides review in the order the program weighs.
 *
 *   npm run build:program && npx tsx scripts/smoke-agents.ts
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { decodeTransactionFromPayload, getTokenPayerFromTransaction } from '@x402/svm';
import { getInitializeInstructionAsync, programDataAddress, TESSERA_PROGRAM_ADDRESS, type Params } from '@tessera/sdk';
import { OrderState, payDirect, readAgent, readOrder, release, submitReview } from '../apps/agents/src/chain.js';
import { loadEvidence, MerchantAgent } from '../apps/agents/src/merchant.js';
import { clientForSigner, generateKeypairBytes, log, REPO_ROOT, sleep, tokenHelpers, waitForChainTime, type Cluster } from './lib.js';

const PORT = 18999;
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${PORT}` };
const USDC = 1_000_000n;
const PARAMS: Params = {
  periodSecs: 2,
  holdSecs: [4, 3, 2, 0],
  tierScore: [100, 300, 500],
  tierPeriods: [1, 2, 3],
  creditFull: USDC,
  pairCap: USDC,
  tenureFull: 4,
  diversityFull: 20,
  reviewPrior: USDC / 100n,
  minOrder: 1_000n,
  deliverSecs: 30,
  unpaidSecs: 30,
  reviewSecs: 60,
  complaintSecs: 90,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 100,
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) log.ok(label);
  else {
    failures += 1;
    console.log(`   FAIL ${label} ${detail}`);
  }
};

const so = resolve(REPO_ROOT, 'target/deploy/tessera.so');
if (!existsSync(so)) throw new Error('run `npm run build:program` first');
const role = async () => clientForSigner((await generateKeypairBytes()).signer, LOCAL);
const deployer = await role();
const ledger = mkdtempSync(join(tmpdir(), 'tessera-smoke-'));
const proc = spawn(
  'solana-test-validator',
  ['--reset', '--quiet', '--ledger', ledger, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1001), '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so, deployer.identity.address],
  { stdio: 'ignore' },
);
const evidenceBefore = loadEvidence().length;

try {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(LOCAL.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) });
      if (((await r.json()) as { result?: string }).result === 'ok') break;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  const [ops, arbiter, treasury, merchantKey, buyer] = await Promise.all([role(), role(), role(), role(), role()]);
  for (const c of [deployer, ops, arbiter, merchantKey, buyer]) await ops.rpc.requestAirdrop(c.identity.address, lamports(10_000_000_000n)).send();
  await sleep(2000);

  const mintSigner = (await generateKeypairBytes()).signer;
  const space = BigInt(getMintSize());
  await ops.sendTransaction([
    getCreateAccountInstruction({ payer: ops.identity, newAccount: mintSigner, lamports: await ops.rpc.getMinimumBalanceForRentExemption(space).send(), space, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mintSigner.address, decimals: 6, mintAuthority: ops.identity.address, freezeAuthority: null }),
  ]);
  const mint = mintSigner.address;
  const tok = tokenHelpers(ops, mint);
  await ops.sendTransaction([await tok.ensureAtaIx(buyer.identity.address)]);
  await ops.sendTransaction([getMintToInstruction({ mint, token: await tok.ata(buyer.identity.address), mintAuthority: ops.identity, amount: 10n * USDC })]);
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({ authority: deployer.identity, mint, arbiter: arbiter.identity.address, treasury: treasury.identity.address, programData: await programDataAddress(), feeBps: 100, params: PARAMS }),
  ]);
  log.ok('local validator, mint and config ready');

  // 1. The merchant quotes. Its signature rides along with the server's.
  const atlas = new MerchantAgent('atlas', 'Atlas: test', merchantKey, ops);
  const quote = await atlas.quote({ buyer: buyer.identity.address, sku: 'telemetry', input: {}, resourceUrl: 'http://localhost/test' });
  const opened = await readOrder(ops, quote.terms.order);
  check('a quote opens an order the merchant co-signed', opened?.merchant === merchantKey.identity.address && opened?.state === OrderState.AwaitingPayment);

  // 2. The x402 payer check reads the right wallet out of a signed transfer.
  {
    const { value: latest } = await buyer.rpc.getLatestBlockhash().send();
    const signed = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(buyer.identity, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      async (m) => appendTransactionMessageInstructions([await tokenHelpers(buyer, mint).transferIx(buyer, quote.terms.vault, 1n)], m),
    ).then(signTransactionMessageWithSigners);
    const payer = getTokenPayerFromTransaction(decodeTransactionFromPayload({ transaction: getBase64EncodedWireTransaction(signed) }));
    check('the payer of an x402 transfer is read as the buyer', payer === buyer.identity.address, `got ${payer}`);
  }

  // 3. The buyer pays the escrow itself; the merchant delivers and keeps its evidence.
  await payDirect(buyer, quote.terms.order, opened!, quote.terms.vault);
  const f = await atlas.fulfil(quote.terms.order);
  check('the merchant delivered', f.state === 'Delivered', f.state);
  const kept = loadEvidence();
  check('the delivery is on file for the arbiter', kept.length === evidenceBefore + 1 && kept.at(-1)?.order === quote.terms.order);

  // 4. The crank releases after the hold, recreating payee accounts first.
  let o = await readOrder(ops, quote.terms.order);
  await waitForChainTime(ops, o!.releaseAt + 1n);
  await release(ops, quote.terms.order, o!);
  o = await readOrder(ops, quote.terms.order);
  check('released after the hold', o?.state === OrderState.Released);
  check('the merchant has no credit before the buyer reviews', (await readAgent(ops, merchantKey.identity.address))!.credit === 0n);

  // 5. Reviews, in the order the program weighs them.
  await submitReview(buyer, ops, quote.terms.order, o!, 5, 'Good telemetry.');
  check('the buyer\'s review gives the merchant its credit', (await readAgent(ops, merchantKey.identity.address))!.credit > 0n);
  o = await readOrder(ops, quote.terms.order);
  await submitReview(merchantKey, ops, quote.terms.order, o!, 5, 'Paid in full.');
  check('the merchant\'s review after the buyer\'s carries weight', (await readAgent(ops, buyer.identity.address))!.ratingWeight > 0n);
} catch (e) {
  failures += 1;
  console.log(`   FAIL stopped on an unexpected error: ${(e as Error).stack ?? e}`);
} finally {
  proc.kill('SIGKILL');
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: agents smoke test`);
process.exit(failures === 0 ? 0 : 1);
