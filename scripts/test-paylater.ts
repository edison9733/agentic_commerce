/**
 * Runs the pay-later program next to the real escrow program on a local
 * validator. Wallets earn their Tessera tiers through real escrow orders, then
 * buy now and pay later against the limit those tiers give them:
 *
 *   1. a wallet with no history gets no credit;
 *   2. a wallet with a tier buys, the merchant is paid at once, the buyer
 *      repays on time and its limit grows;
 *   3. a buyer that never repays is marked in default by a stranger and its
 *      line is frozen;
 *   4. the main refusal paths are attacked with real transactions.
 *
 * Every limit the program applies is recomputed off-chain from the same
 * public accounts (packages/sdk/src/paylater/limit.ts) and must match.
 *
 *   npm run build:program && npm run test:paylater
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

// Its own port, so it never attaches to `npm run paylater:local` or another suite's validator.
const RPC_PORT = Number(process.env.PAYLATER_TEST_RPC_PORT ?? 19599);
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

// Pay-later rules for this run: 10 seconds to repay, then 4 seconds of grace.
const LINE: paylater.LineParams = {
  tierLimit: [0n, 2n * USDC, 5n * USDC, 10n * USDC],
  stepBps: 2_500,
  maxBoostBps: 10_000,
  termSecs: 10,
  graceSecs: 4,
  feeBps: 200,
  minMerchantTier: 1,
  minLoan: 1_000n,
};

// ----------------------------------------------------------------- assertions

let checks = 0;
let failures = 0;
const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x));

function eq(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  if (show(actual) !== show(expected)) {
    failures += 1;
    console.log(`   FAIL ${label}: got ${show(actual)}, expected ${show(expected)}`);
  } else log.ok(label);
}

async function expectFail(label: string, expected: string, fn: () => Promise<unknown>): Promise<void> {
  checks += 1;
  try {
    await fn();
  } catch (e) {
    const text = errText(e);
    if (text.includes(expected)) log.ok(`${label}: rejected with ${expected}`);
    else {
      failures += 1;
      console.log(`   FAIL ${label}: expected ${expected}, got: ${text.slice(-900)}`);
    }
    return;
  }
  failures += 1;
  console.log(`   FAIL ${label}: the call succeeded but should have been rejected`);
}

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

const role = async () => clientForSigner((await generateKeypairBytes()).signer, LOCAL);
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
  const aTier = (await live(alice)).tier;
  const bTier = (await live(bob)).tier;
  const m1Tier = (await live(m1)).tier;
  eq('alice, bob and m1 have earned at least Established through escrow', [aTier >= 2, bTier >= 2, m1Tier >= 2], [true, true, true]);
  eq('the fresh wallet is still New', (await live(fresh)).tier, 0);

  // ------------------------------------------------------------ the pool
  log.step('The lending pool');
  const pool = await paylater.poolPda();
  const plProgramData = await programDataAddress(PAYLATER);
  const initPool = async (by: ScriptClient, params: paylater.LineParams) =>
    by.sendTransaction([
      await paylater.getInitializeInstructionAsync({ authority: by.identity, mint, programData: plProgramData, params }),
    ]);
  await expectFail('a wallet that is not the upgrade authority creates the pool', 'Unauthorized', () => initPool(stranger, LINE));
  await expectFail('the pool gives brand-new wallets credit', 'InvalidParams', () =>
    initPool(deployer, { ...LINE, tierLimit: [USDC, 2n * USDC, 5n * USDC, 10n * USDC] }),
  );
  await expectFail('the pool keeps more than 10% of each purchase', 'InvalidParams', () => initPool(deployer, { ...LINE, feeBps: 1_001 }));
  // Anyone can create ATA(mint, pool) before the pool exists; that must not block it.
  await stranger.sendTransaction([await tok.ensureAtaIx(pool, stranger)]);
  eq('an attacker created the pool vault before the pool', (await rpc.getAccountInfo(await tok.ata(pool), { encoding: 'base64' }).send()).value !== null, true);
  await initPool(deployer, LINE);
  eq('pool params stored on-chain, the vault created first is accepted', (await paylater.fetchPool(rpc, pool)).data.params, LINE);
  const updateIx = async (by: ScriptClient, params: paylater.LineParams) =>
    paylater.getUpdateParamsInstructionAsync({ authority: by.identity, params });
  await expectFail('a stranger rewrites the pool rules', 'Unauthorized', async () =>
    stranger.sendTransaction([await updateIx(stranger, { ...LINE, feeBps: 0 })]),
  );
  await expectFail('the authority changes the rules to give New wallets credit', 'InvalidParams', async () =>
    deployer.sendTransaction([await updateIx(deployer, { ...LINE, tierLimit: [1n, 2n * USDC, 5n * USDC, 10n * USDC] })]),
  );
  await server.sendTransaction([
    await paylater.getDepositInstructionAsync({ mint, funder: server.identity, funderToken: await tok.ata(server.identity.address), amount: 50n * USDC }),
  ]);
  eq('the pool holds 50 USDC of liquidity', await tok.balance(pool), 50n * USDC);

  const buyIx = async (buyer: ScriptClient, merchant: Address, amount: bigint, loanId = newOrderId()) => ({
    loanId,
    ix: await paylater.getBuyNowInstructionAsync({
      mint, buyer: buyer.identity, merchant, loanId, amount, requestHash,
    }),
  });
  const buy = async (buyer: ScriptClient, merchant: Address, amount: bigint) => {
    const { loanId, ix } = await buyIx(buyer, merchant, amount);
    await buyer.sendTransaction([ix]);
    return paylater.loanPdaOf(buyer.identity.address, loanId);
  };
  const repayIx = async (loan: Address, payer: ScriptClient) =>
    paylater.getRepayInstructionAsync({
      mint, loan, line: await paylater.linePdaOf((await paylater.fetchLoan(rpc, loan)).data.buyer),
      payer: payer.identity, payerToken: await tok.ata(payer.identity.address),
    });
  const lineOf = async (c: ScriptClient) => (await paylater.fetchMaybeCreditLine(rpc, await paylater.linePdaOf(c.identity.address)));

  // --------------------------------------------- 1. no history, no credit
  log.step('1. A wallet with no history gets no credit');
  await expectFail('a New wallet buys on credit', 'CreditLimitExceeded', async () =>
    fresh.sendTransaction([(await buyIx(fresh, m1.identity.address, 1_000n)).ix]),
  );
  const nobody = await role();
  await rpc.requestAirdrop(nobody.identity.address, lamports(2_000_000_000n)).send();
  await sleep(1500);
  await expectFail('a wallet with no credit file at all buys on credit', 'ConstraintOwner', async () =>
    nobody.sendTransaction([(await buyIx(nobody, m1.identity.address, 1_000n)).ix]),
  );
  await expectFail('a tiered buyer pays a New merchant on credit', 'MerchantTierTooLow', async () =>
    alice.sendTransaction([(await buyIx(alice, fresh.identity.address, 1_000n)).ix]),
  );
  await expectFail('a buyer pays itself on credit', 'SelfDealing', async () =>
    alice.sendTransaction([(await buyIx(alice, alice.identity.address, 1_000n)).ix]),
  );
  await expectFail('a purchase below the minimum', 'AmountTooSmall', async () =>
    alice.sendTransaction([(await buyIx(alice, m1.identity.address, 999n)).ix]),
  );

  // ------------------------------------- 2. buy now, repay on time, grow
  log.step('2. Alice buys now, pays later, on time');
  const aliceLimit0 = paylater.limit(paylater.NO_LINE, LINE, aTier, (await live(alice)).score);
  log.info(`alice: tier ${aTier}, limit about ${fromUnits(aliceLimit0)} USDC`);
  const price = aliceLimit0 / 2n;
  const m1Before = await tok.balance(m1.identity.address);
  const loanA = await buy(alice, m1.identity.address, price);
  const la = (await paylater.fetchLoan(rpc, loanA)).data;
  const atOpen = await live(alice, la.createdAt);
  eq('the program used alice\'s live Tessera score', [la.buyerTier, la.buyerScore], [atOpen.tier, atOpen.score]);
  eq('the limit matches the off-chain formula', la.limitAtOpen, paylater.limit(paylater.NO_LINE, LINE, atOpen.tier, atOpen.score));
  const fee = paylater.feeOf(price, LINE);
  eq('the merchant was paid at once, minus the 2% pool fee', (await tok.balance(m1.identity.address)) - m1Before, price - fee);
  eq('the loan is due in 10 seconds', la.dueAt - la.createdAt, BigInt(LINE.termSecs));
  const line1 = (await lineOf(alice));
  eq('alice owes the full price', line1.exists && line1.data.outstanding, price);
  await expectFail('alice spends more than her remaining credit', 'CreditLimitExceeded', async () =>
    alice.sendTransaction([(await buyIx(alice, m1.identity.address, la.limitAtOpen - price + 1n)).ix]),
  );
  await expectFail('a stranger marks a loan in default before it is due', 'NotOverdue', async () =>
    stranger.sendTransaction([await paylater.getMarkDefaultInstructionAsync({ loan: loanA, line: await paylater.linePdaOf(alice.identity.address) })]),
  );
  const aliceBefore = await tok.balance(alice.identity.address);
  await alice.sendTransaction([await repayIx(loanA, alice)]);
  eq('alice repaid the full price, no interest', aliceBefore - (await tok.balance(alice.identity.address)), price);
  const la2 = (await paylater.fetchLoan(rpc, loanA)).data;
  eq('the loan is marked repaid on time', la2.state, paylater.LoanState.RepaidOnTime);
  await expectFail('the same loan is repaid twice', 'InvalidState', async () => alice.sendTransaction([await repayIx(loanA, alice)]));
  const line2 = (await lineOf(alice));
  if (!line2.exists) throw new Error('alice has no line');
  eq('alice owes nothing and has one on-time repayment', [line2.data.outstanding, line2.data.repaidOnTime], [0n, 1]);
  const nowS = await live(alice);
  const grown = paylater.limit(line2.data, LINE, nowS.tier, nowS.score);
  const flat = paylater.limit(paylater.NO_LINE, LINE, nowS.tier, nowS.score);
  eq('repaying on time raised her limit by 25%', grown, (flat * 12_500n) / 10_000n);
  // The program must apply that boost too: buy more than the unboosted limit allows.
  const boosted = flat + (grown - flat) / 2n;
  const loanA2 = await buy(alice, m1.identity.address, boosted);
  const la3 = (await paylater.fetchLoan(rpc, loanA2)).data;
  const at3 = await live(alice, la3.createdAt);
  eq('the program applied the boost: a purchase above the unboosted limit went through', [boosted > flat, la3.amount], [true, boosted]);
  eq('and its limit matches the off-chain formula with the boost', la3.limitAtOpen, paylater.limit(line2.data, LINE, at3.tier, at3.score));
  await expectFail('one unit past the boosted limit', 'CreditLimitExceeded', async () =>
    alice.sendTransaction([(await buyIx(alice, m1.identity.address, la3.limitAtOpen - boosted + 1n)).ix]),
  );
  await alice.sendTransaction([await repayIx(loanA2, alice)]);
  eq('alice repaid that one on time too', (await paylater.fetchLoan(rpc, loanA2)).data.state, paylater.LoanState.RepaidOnTime);

  // ------------------------------------ 2b. a tab: buy several, pay once
  log.step('2b. Alice buys three things and settles the tab in one transaction');
  const lineTab = await lineOf(alice);
  if (!lineTab.exists) throw new Error('alice has no line');
  const atTab = await live(alice);
  const each = paylater.limit(lineTab.data, LINE, atTab.tier, atTab.score) / 4n;
  const tab: Address[] = [];
  for (let i = 0; i < 3; i += 1) tab.push(await buy(alice, m1.identity.address, each));
  const owedTab = (await lineOf(alice));
  eq('alice owes the whole tab', owedTab.exists && owedTab.data.outstanding, each * 3n);
  const listed = paylater.owed(await paylater.fetchLoansOf(rpc, alice.identity.address)).map((l) => l.address).sort();
  eq('the chain lists her three open loans', listed, [...tab].sort());
  await alice.sendTransaction(await Promise.all(tab.map((loan) => repayIx(loan, alice))));
  const settled = await lineOf(alice);
  eq('one transaction settled the tab: nothing owed, three more on-time repayments', settled.exists && [settled.data.outstanding, settled.data.repaidOnTime], [0n, 5]);
  await expectFail('a stranger closes alice\'s loan to take the rent', 'Unauthorized', async () =>
    stranger.sendTransaction([paylater.getCloseLoanInstruction({ loan: loanA, buyer: stranger.identity.address })]),
  );
  await stranger.sendTransaction([paylater.getCloseLoanInstruction({ loan: loanA, buyer: alice.identity.address })]);
  eq('the repaid loan was closed, its rent back to alice', (await rpc.getAccountInfo(loanA).send()).value, null);

  // ----------------------------------------------- 3. default and freeze
  log.step('3. Bob buys and never repays');
  const bobLimit = paylater.limit(paylater.NO_LINE, LINE, bTier, (await live(bob)).score);
  const loanB = await buy(bob, m1.identity.address, bobLimit / 2n);
  const lb = (await paylater.fetchLoan(rpc, loanB)).data;
  const bobLine = await paylater.linePdaOf(bob.identity.address);
  const markIx = async () => paylater.getMarkDefaultInstructionAsync({ loan: loanB, line: bobLine });
  eq('the loan carries its own default deadline', lb.defaultAfter, lb.dueAt + BigInt(LINE.graceSecs));
  // A later rules change must not shorten the grace period of a loan already open.
  await deployer.sendTransaction([await updateIx(deployer, { ...LINE, graceSecs: 0 })]);
  await waitForChainTime(server, lb.dueAt + 1n);
  await expectFail('marked in default during the grace period, after the rules cut grace to 0', 'NotOverdue', async () =>
    stranger.sendTransaction([await markIx()]),
  );
  await deployer.sendTransaction([await updateIx(deployer, LINE)]);
  await waitForChainTime(server, lb.defaultAfter + 1n);
  await stranger.sendTransaction([await markIx()]);
  eq('a stranger marked bob\'s loan in default', (await paylater.fetchLoan(rpc, loanB)).data.state, paylater.LoanState.Defaulted);
  const bl = (await paylater.fetchCreditLine(rpc, bobLine)).data;
  eq('the default is on bob\'s public record', [bl.defaults, bl.outstanding], [1, lb.amount]);
  eq('bob\'s limit is frozen at 0', paylater.limit(bl, LINE, bTier, (await live(bob)).score), 0n);
  await expectFail('bob buys again after defaulting', 'CreditLimitExceeded', async () =>
    bob.sendTransaction([(await buyIx(bob, m1.identity.address, 1_000n)).ix]),
  );
  await expectFail('the default is marked twice', 'InvalidState', async () => stranger.sendTransaction([await markIx()]));
  await expectFail('bob closes his unpaid loan to make it disappear', 'InvalidState', async () =>
    bob.sendTransaction([paylater.getCloseLoanInstruction({ loan: loanB, buyer: bob.identity.address })]),
  );
  await bob.sendTransaction([await repayIx(loanB, bob)]);
  const bl2 = (await paylater.fetchCreditLine(rpc, bobLine)).data;
  eq('bob can still pay the debt late: it clears, the default stays', [bl2.outstanding, bl2.repaidLate, bl2.defaults], [0n, 1, 1]);
  eq('and his line stays frozen', paylater.limit(bl2, LINE, bTier, (await live(bob)).score), 0n);

  // ------------------------------------------------- 4. pool accounting
  log.step('4. Pool accounting and withdrawals');
  await expectFail('a stranger withdraws the pool', 'Unauthorized', async () =>
    stranger.sendTransaction([
      await paylater.getWithdrawInstructionAsync({ mint, authority: stranger.identity, to: await tok.ata(stranger.identity.address), amount: 1n }),
    ]),
  );
  const p = (await paylater.fetchPool(rpc, pool)).data;
  const vaultBalance = await tok.balance(pool);
  eq('vault = deposits - withdrawals - paid to merchants + repaid', vaultBalance, p.deposited - p.withdrawn - (p.lent - p.feesEarned) + p.repaid);
  eq('nothing is outstanding', p.outstanding, 0n);
  log.info(`pool: lent ${fromUnits(p.lent)}, repaid ${fromUnits(p.repaid)}, fees ${fromUnits(p.feesEarned)}, defaulted ${fromUnits(p.defaulted)} USDC`);
  await deployer.sendTransaction([await tok.ensureAtaIx(deployer.identity.address, deployer)]);
  await deployer.sendTransaction([
    await paylater.getWithdrawInstructionAsync({ mint, authority: deployer.identity, to: await tok.ata(deployer.identity.address), amount: vaultBalance }),
  ]);
  eq('the authority withdrew the liquidity and the fees', await tok.balance(deployer.identity.address), vaultBalance);
  await expectFail('a purchase when the pool is empty', 'PoolEmpty', async () =>
    alice.sendTransaction([(await buyIx(alice, m1.identity.address, 1_000n)).ix]),
  );
} catch (e) {
  failures += 1;
  console.log(`\n   FAIL the run stopped on an unexpected error:\n${errText(e).slice(0, 1500)}`);
} finally {
  proc.kill('SIGKILL');
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
