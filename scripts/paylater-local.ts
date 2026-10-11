/**
 * A local pay-later world to try the commands by hand: a validator running
 * the real escrow and pay-later programs, wallets that earned their tiers
 * through real escrow orders, and a funded pool. It prints each wallet's
 * keypair file and stays up until Ctrl-C.
 *
 *   npm run build:program && npm run paylater:local
 *   npm run tessera -- credit <alice> --rpc http://127.0.0.1:18999
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lamports, type Address } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  agentPdaOf,
  configPda,
  fetchAgent,
  fetchConfig,
  fromUnits,
  getConfirmFundedInstructionAsync,
  getDeliverInstructionAsync,
  getEnsureAgentInstructionAsync,
  getInitializeInstructionAsync,
  getOpenOrderInstructionAsync,
  getReleaseInstruction,
  getSubmitReviewInstructionAsync,
  newOrderId,
  orderAddresses,
  pairPdaOf,
  paylater,
  programDataAddress,
  score,
  settleAccounts,
  sha256,
  TESSERA_PROGRAM_ADDRESS,
  type Params,
} from '@tessera/sdk';
import {
  chainTime,
  clientForSigner,
  errText,
  generateKeypairBytes,
  log,
  REPO_ROOT,
  sleep,
  tokenHelpers,
  waitForChainTime,
  type Cluster,
  type ScriptClient,
} from './lib.js';

const RPC_PORT = Number(process.env.PAYLATER_RPC_PORT ?? 18999);
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${RPC_PORT}` };
const USDC = 1_000_000n;
const PAYLATER = paylater.TESSERA_PAYLATER_PROGRAM_ADDRESS;

// The escrow's compressed local params (as in test-local.ts): 2-second periods.
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
  deliverSecs: 6,
  unpaidSecs: 6,
  reviewSecs: 20,
  complaintSecs: 32,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 100,
};

// Pay-later rules for this world: 60 seconds to repay, then 5 seconds of grace.
const LINE: paylater.LineParams = {
  tierLimit: [0n, 2n * USDC, 5n * USDC, 10n * USDC],
  stepBps: 2_500,
  maxBoostBps: 10_000,
  termSecs: 60,
  graceSecs: 5,
  feeBps: 200,
  minMerchantTier: 1,
  minLoan: 1_000n,
};

// ------------------------------------------------------------------ validator

async function startValidator(upgradeAuthority: Address): Promise<{ proc: ChildProcess; ledger: string }> {
  const so = (name: string) => {
    const p = resolve(REPO_ROOT, `target/deploy/${name}.so`);
    if (!existsSync(p)) throw new Error(`target/deploy/${name}.so is missing: run \`npm run build:program\` first`);
    return p;
  };
  const ledger = mkdtempSync(join(tmpdir(), 'tessera-paylater-ledger-'));
  const proc = spawn(
    'solana-test-validator',
    [
      '--reset',
      '--quiet',
      '--ledger', ledger,
      '--rpc-port', String(RPC_PORT),
      '--faucet-port', String(RPC_PORT + 1001),
      '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so('tessera'), upgradeAuthority,
      '--upgradeable-program', PAYLATER, so('tessera_paylater'), upgradeAuthority,
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(LOCAL.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      if (((await res.json()) as { result?: string }).result === 'ok') return { proc, ledger };
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  proc.kill('SIGKILL');
  throw new Error('local validator did not become healthy');
}

// ----------------------------------------------------------------------- main

const keys = mkdtempSync(join(tmpdir(), 'tessera-paylater-keys-'));
const bytesOf = new Map<string, Uint8Array>();
const role = async () => {
  const { signer, bytes } = await generateKeypairBytes();
  bytesOf.set(signer.address, bytes);
  return clientForSigner(signer, LOCAL);
};
const deployer = await role();
const { proc, ledger } = await startValidator(deployer.identity.address);

try {
  const server = await role();
  const arbiter = await role();
  const treasury = await role();
  const stranger = await role();
  const m1 = await role();
  const m2 = await role();
  const alice = await role(); // repays on time
  const bob = await role(); // never repays
  const fresh = await role(); // no history at all
  const everyone = [deployer, server, arbiter, treasury, stranger, m1, m2, alice, bob, fresh];
  const rpc = server.rpc;

  log.step('Setup: funded wallets, a test mint, the escrow program');
  for (const c of everyone) await rpc.requestAirdrop(c.identity.address, lamports(20_000_000_000n)).send();
  for (let i = 0; i < 60; i += 1) {
    if ((await rpc.getBalance(everyone.at(-1)!.identity.address).send()).value > 0n) break;
    await sleep(250);
  }
  const mintSigner = (await generateKeypairBytes()).signer;
  const space = BigInt(getMintSize());
  await server.sendTransaction([
    getCreateAccountInstruction({
      payer: server.identity,
      newAccount: mintSigner,
      lamports: await rpc.getMinimumBalanceForRentExemption(space).send(),
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({ mint: mintSigner.address, decimals: 6, mintAuthority: server.identity.address, freezeAuthority: null }),
  ]);
  const mint = mintSigner.address;
  const tok = tokenHelpers(server, mint);
  for (const c of [server, treasury, m1, m2, alice, bob, fresh, stranger]) {
    await server.sendTransaction([await tok.ensureAtaIx(c.identity.address)]);
  }
  for (const c of [server, alice, bob, fresh, m1, m2]) {
    await server.sendTransaction([
      getMintToInstruction({ mint, token: await tok.ata(c.identity.address), mintAuthority: server.identity, amount: 100n * USDC }),
    ]);
  }
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({
      authority: deployer.identity,
      mint,
      arbiter: arbiter.identity.address,
      treasury: treasury.identity.address,
      programData: await programDataAddress(),
      feeBps: 100,
      params: PARAMS,
    }),
  ]);
  for (const c of [m1, m2, alice, bob, fresh, stranger]) {
    await server.sendTransaction([await getEnsureAgentInstructionAsync({ wallet: c.identity.address, payer: server.identity })]);
  }
  log.ok(`mint ${mint}, escrow initialised, 6 credit files`);

  // ---------------------------------------- escrow history earns the tiers
  const requestHash = await sha256('GET /report?wallet=demo');
  async function escrowOrder(buyer: ScriptClient, merchant: ScriptClient, amount: bigint): Promise<void> {
    const id = newOrderId();
    const { order, vault } = await orderAddresses(id, mint);
    await server.sendTransaction([
      await getOpenOrderInstructionAsync({
        mint, buyer: buyer.identity.address, merchant: merchant.identity, payer: server.identity, orderId: id, amount, requestHash, minHoldSecs: 0,
      }),
    ]);
    await buyer.sendTransaction([await tok.transferIx(buyer, vault, amount)]);
    await stranger.sendTransaction([await getConfirmFundedInstructionAsync({ order, mint })]);
    await merchant.sendTransaction([await getDeliverInstructionAsync({ order, merchant: merchant.identity, deliveryHash: requestHash })]);
    const settle = await settleAccounts(
      order,
      { buyer: buyer.identity.address, merchant: merchant.identity.address, mint, payer: server.identity.address },
      treasury.identity.address,
    );
    for (let i = 0; ; i += 1) {
      try {
        await buyer.sendTransaction([getReleaseInstruction({ ...settle, authority: buyer.identity })]);
        break;
      } catch (e) {
        if (i > 20) throw e;
        await sleep(500);
      }
    }
    const pair = await pairPdaOf(buyer.identity.address, merchant.identity.address);
    for (const [reviewer, subject] of [[buyer, merchant], [merchant, buyer]] as const) {
      await reviewer.sendTransaction([
        await getSubmitReviewInstructionAsync({
          order, subject: subject.identity.address, pair, reviewer: reviewer.identity, payer: reviewer.identity, rating: 5, text: 'Good trade.',
        }),
      ]);
    }
  }

  const configAddr = await configPda();
  const cfgParams = (await fetchConfig(rpc, configAddr)).data.params;
  const live = async (c: ScriptClient, at?: bigint) => {
    const a = (await fetchAgent(rpc, await agentPdaOf(c.identity.address))).data;
    return score.evaluate(a, cfgParams, at ?? (await chainTime(server)));
  };

  log.step('Earning Tessera tiers through real escrow orders (a few periods)');
  const traders: [ScriptClient, ScriptClient][] = [[alice, m1], [bob, m2], [alice, m2], [bob, m1], [m1, m2], [m2, m1]];
  for (let round = 0; round < 12; round += 1) {
    for (const [b, m] of traders) await escrowOrder(b, m, USDC / 2n);
    const tiers = await Promise.all([alice, bob, m1, m2].map(async (c) => (await live(c)).tier));
    log.info(`round ${round + 1}: tiers alice ${tiers[0]}, bob ${tiers[1]}, m1 ${tiers[2]}, m2 ${tiers[3]}`);
    if (tiers.every((t) => t >= 2)) break;
  }

  log.step('The pool');
  await deployer.sendTransaction([
    await paylater.getInitializeInstructionAsync({ authority: deployer.identity, mint, programData: await programDataAddress(PAYLATER), params: LINE }),
  ]);
  await server.sendTransaction([
    await paylater.getDepositInstructionAsync({ mint, funder: server.identity, funderToken: await tok.ata(server.identity.address), amount: 50n * USDC }),
  ]);
  log.ok('pool funded with 50 test USDC');

  const TIERS = ['New', 'Building', 'Established', 'Trusted'];
  console.log(`\nLocal pay-later world on ${LOCAL.rpcUrl} (test money). Keypairs in ${keys}:`);
  for (const [name, c, what] of [
    ['alice', alice, 'buyer, will repay'],
    ['bob', bob, 'buyer, will not repay'],
    ['fresh', fresh, 'brand-new wallet'],
    ['shop', m1, 'merchant'],
    ['stranger', stranger, 'anyone'],
  ] as const) {
    const file = join(keys, `${name}.json`);
    writeFileSync(file, JSON.stringify(Array.from(bytesOf.get(c.identity.address)!)), { mode: 0o600 });
    const e = await live(c);
    console.log(`  ${name.padEnd(9)} ${c.identity.address}  ${TIERS[e.tier]} ${e.score}  (${what})  ${file}`);
  }
  console.log('\nCtrl-C to stop.');
  await new Promise<void>((done) => process.once('SIGINT', () => done()));

  } catch (e) {
  console.log(`\nthe world stopped on an unexpected error:\n${errText(e).slice(0, 1500)}`);
} finally {
  proc.kill('SIGKILL');
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
}
