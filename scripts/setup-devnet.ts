/**
 * Devnet bootstrap. Safe to run again: every step checks the chain first.
 *
 *   1. checks the program is deployed and (re)writes the on-chain config;
 *   2. creates the role and agent keypairs under `.keys/` (never committed);
 *   3. funds them with devnet SOL and devnet USDC from the deployer wallet;
 *   4. gives every honest agent an on-chain profile.
 *
 *   npm run setup:devnet
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchEncodedAccount, lamports, type Address, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  agentPdaOf,
  configPda,
  DEVNET_PARAMS,
  fetchMaybeAgent,
  fetchMaybeConfig,
  fromUnits,
  getEnsureAgentInstructionAsync,
  getInitializeInstructionAsync,
  getSetProfileInstructionAsync,
  getUpdateConfigInstructionAsync,
  programDataAddress,
  PROTOCOL_FEE_BPS,
  TESSERA_PROGRAM_ADDRESS,
  toUnits,
  USDC_DEVNET,
} from '@tessera/sdk';
import { ADVERSARIES, agentCardUrl, BUYERS, CAST, keyPath, MERCHANTS } from './cast.js';
import {
  clientForSigner,
  explorerAddress,
  loadKeypair,
  loadOrCreateKeypair,
  log,
  REPO_ROOT,
  sigOf,
  tokenHelpers,
  type ScriptClient,
} from './lib.js';

const SOL = 1_000_000_000n;
const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

const deployer = clientForSigner(await loadKeypair(process.env.DEPLOYER_KEYPAIR ?? '~/.config/solana/id.json'));
const rpc = deployer.rpc;
const server = clientForSigner(await loadOrCreateKeypair('.keys/server.json'));
const arbiter = clientForSigner(await loadOrCreateKeypair('.keys/arbiter.json'));
const treasury = await loadOrCreateKeypair('.keys/treasury.json');
const agents = new Map<string, ScriptClient>();
for (const c of CAST) agents.set(c.id, clientForSigner(await loadOrCreateKeypair(keyPath(c.id))));

log.step('Program');
const program = await fetchEncodedAccount(rpc, TESSERA_PROGRAM_ADDRESS);
if (!program.exists) {
  throw new Error(
    `Program ${TESSERA_PROGRAM_ADDRESS} is not on devnet. Deploy it first:\n` +
      '  solana program deploy target/deploy/tessera.so --program-id target/deploy/tessera-keypair.json --url devnet',
  );
}
log.ok(`${TESSERA_PROGRAM_ADDRESS} is deployed`);

log.step('Config');
const config = await configPda();
const existing = await fetchMaybeConfig(rpc, config);
if (!existing.exists) {
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({
      authority: deployer.identity,
      mint: USDC_DEVNET,
      arbiter: arbiter.identity.address,
      treasury: treasury.address,
      programData: await programDataAddress(),
      feeBps: PROTOCOL_FEE_BPS,
      params: DEVNET_PARAMS,
    }),
  ]);
  log.ok(`initialised ${config}`);
} else {
  const d = existing.data;
  const same =
    show(d.params) === show(DEVNET_PARAMS) &&
    d.feeBps === PROTOCOL_FEE_BPS &&
    d.arbiter === arbiter.identity.address &&
    d.treasury === treasury.address;
  if (same) log.ok(`${config} already matches`);
  else if (d.authority !== deployer.identity.address) {
    // Someone else's deployment: use its rules as they are. Disputes on it are
    // resolved by its arbiter, not by the arbiter key created here.
    log.warn(`${config} belongs to ${d.authority}; leaving its config untouched`);
  } else {
    await deployer.sendTransaction([
      await getUpdateConfigInstructionAsync({
        authority: deployer.identity,
        feeBps: PROTOCOL_FEE_BPS,
        params: DEVNET_PARAMS,
        arbiter: arbiter.identity.address,
        treasury: treasury.address,
      }),
    ]);
    log.ok(`updated ${config}`);
  }
}

log.step('Devnet SOL');
async function topUp(label: string, to: Address, target: bigint): Promise<void> {
  const have = (await rpc.getBalance(to).send()).value;
  if (have >= target / 2n) return log.info(`${label.padEnd(10)} ${to} has ${fromUnits(have, 9, 3)} SOL`);
  await deployer.sendTransaction([
    getTransferSolInstruction({ source: deployer.identity, destination: to, amount: lamports(target - have) }),
  ]);
  log.ok(`${label.padEnd(10)} ${to} topped up to ${fromUnits(target, 9, 3)} SOL`);
}
await topUp('server', server.identity.address, 5n * SOL);
await topUp('arbiter', arbiter.identity.address, SOL / 20n);
for (const c of CAST) {
  await topUp(c.id, agents.get(c.id)!.identity.address, c.role === 'merchant' ? SOL / 10n : SOL / 20n);
}

log.step('Devnet USDC');
const tok = tokenHelpers(deployer, USDC_DEVNET);
const needAta: Address[] = [treasury.address, server.identity.address, ...CAST.map((c) => agents.get(c.id)!.identity.address)];
for (let i = 0; i < needAta.length; i += 6) {
  await deployer.sendTransaction(await Promise.all(needAta.slice(i, i + 6).map((a) => tok.ensureAtaIx(a))));
}
log.ok(`${needAta.length} token accounts exist`);
async function fundUsdc(id: string, target: string): Promise<void> {
  const to = agents.get(id)!.identity.address;
  const want = toUnits(target);
  const have = await tok.balance(to);
  if (have >= want / 2n) return log.info(`${id.padEnd(10)} has ${fromUnits(have)} USDC`);
  await deployer.sendTransaction([await tok.transferIx(deployer, await tok.ata(to), want - have)]);
  log.ok(`${id.padEnd(10)} funded to ${target} USDC`);
}
for (const b of BUYERS) await fundUsdc(b.id, '4');
await fundUsdc('charlie', '2');
for (const s of ADVERSARIES.filter((a) => a.behaviour === 'ring-buyer')) await fundUsdc(s.id, '1');
log.info(`deployer keeps ${fromUnits(await tok.balance(deployer.identity.address))} USDC in reserve`);

log.step('On-chain profiles');
async function profile(id: string, signer: KeyPairSigner, client: ScriptClient, uri: string): Promise<void> {
  const pda = await agentPdaOf(signer.address);
  const acct = await fetchMaybeAgent(rpc, pda);
  if (acct.exists && acct.data.name === id && acct.data.uri === uri) return log.info(`${id.padEnd(10)} ${signer.address}`);
  await server.sendTransaction([await getEnsureAgentInstructionAsync({ wallet: signer.address, payer: server.identity })]);
  await client.sendTransaction([await getSetProfileInstructionAsync({ wallet: signer, name: id, uri, kind: 2 })]);
  log.ok(`${id.padEnd(10)} ${signer.address} registered`);
}
// Attackers register themselves later, when they join the network.
for (const c of [...MERCHANTS, ...BUYERS]) {
  const client = agents.get(c.id)!;
  await profile(c.id, client.identity as KeyPairSigner, client, c.role === 'merchant' ? agentCardUrl(c.id) : '');
}

const deployment = {
  cluster: 'devnet',
  program: TESSERA_PROGRAM_ADDRESS,
  config,
  mint: USDC_DEVNET,
  feeBps: PROTOCOL_FEE_BPS,
  authority: deployer.identity.address,
  arbiter: arbiter.identity.address,
  treasury: treasury.address,
  server: server.identity.address,
  agents: Object.fromEntries(CAST.map((c) => [c.id, { address: agents.get(c.id)!.identity.address, role: c.role, title: c.title, behaviour: c.behaviour }])),
};
mkdirSync(resolve(REPO_ROOT, 'deployments'), { recursive: true });
writeFileSync(resolve(REPO_ROOT, 'deployments/devnet.json'), JSON.stringify(deployment, null, 2) + '\n');
log.step('Done');
log.info(`program  ${explorerAddress(TESSERA_PROGRAM_ADDRESS)}`);
log.info(`config   ${explorerAddress(config)}`);
log.info('wrote deployments/devnet.json (public addresses only)');
void sigOf;
