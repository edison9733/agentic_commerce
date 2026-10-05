/**
 * Bridge to the Solana Agent Registry, the Solana Foundation's ERC-8004
 * registry (solana.com/agent-registry). The registry says who an agent is and
 * collects feedback about it. Tessera says what happened to the money. This
 * script joins the two on devnet:
 *
 *   1. registers each merchant agent in the registry (one Metaplex Core asset
 *      each, owned by the merchant's own wallet);
 *   2. sets the asset's agent wallet to that wallet, and writes the address of
 *      its Tessera credit file into the asset's on-chain metadata, so either
 *      record can be found from the other;
 *   3. turns on the registry's own scoring engine (ATOM) for the asset, so
 *      the registry aggregates what it is told;
 *   4. with `--mirror N`, copies each merchant's N latest buyer reviews into
 *      the registry as feedback, using the registry's own x402 tags. Every
 *      copy points at the Tessera review account, which can only exist if the
 *      order it reviews was paid into escrow and settled.
 *
 *   npm run registry                  register and link (safe to run again)
 *   npm run registry -- --mirror 3    also mirror 3 reviews per merchant
 *   npm run registry -- --dry         print the registration files, send nothing
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lamports, type Address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { Keypair, PublicKey } from '@solana/web3.js';
import { buildRegistrationFileJson, DEVNET_AGENT_REGISTRY_PROGRAM_ID, ServiceType, SolanaSDK, TrustModel } from '8004-solana';
import { agentPdaOf, fetchAllOrders, fetchAllReviews, fromUnits, TESSERA_PROGRAM_ADDRESS } from '@tessera/sdk';
import { agentCardUrl, BUYERS, keyPath, MERCHANTS } from './cast.js';
import { clientForSigner, DEVNET, explorerAddress, loadKeypair, log, REPO_ROOT, sleep } from './lib.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const DRY = flag('dry');
const MIRROR = option('mirror', 0);

const REPO_RAW = process.env.REGISTRY_URI_BASE ?? 'https://raw.githubusercontent.com/edison9733/agentic_commerce/main';
const RPC_URL = process.env.RPC_URL ?? DEVNET.rpcUrl;
const STATE_FILE = resolve(REPO_ROOT, 'deployments/registry.json');
const FILES_DIR = resolve(REPO_ROOT, 'deployments/registry');

type Entry = { asset: string; wallet: string; tesseraAccount: string; uri: string; registeredTx: string; walletSet?: boolean; linked?: boolean; atom?: boolean };
type Mirrored = { agent: string; asset: string; client: string; order: string; rating: number; amount: string; tag: string; tx: string };
type State = {
  cluster: 'devnet';
  registryProgram: string;
  sdk: string;
  agents: Record<string, Entry>;
  /** Keyed by the Tessera review account that was copied. */
  feedback: Record<string, Mirrored>;
};

const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State)
  : { cluster: 'devnet', registryProgram: DEVNET_AGENT_REGISTRY_PROGRAM_ID.toBase58(), sdk: '8004-solana@0.8.5', agents: {}, feedback: {} };
const save = () => {
  mkdirSync(FILES_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
};

const web3Keypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8')) as number[]));
const sdkFor = (signer: Keypair) => new SolanaSDK({ cluster: 'devnet', rpcUrl: RPC_URL, signer });

/** The public devnet RPC rate-limits; a registry call is worth a few tries. */
async function attempt<T>(what: string, run: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await run();
    } catch (e) {
      if (i >= tries) throw new Error(`${what}: ${(e as Error).message}`);
      await sleep(1500 * i);
    }
  }
}
/** The SDK returns a sent result, or an unsent one in a mode this script never uses. */
type Sent = { success: boolean; signature: string; error?: string };
function done(what: string, r: unknown): Sent {
  const s = r as Partial<Sent>;
  if (!s.success || !s.signature) throw new Error(`${what} failed: ${s.error ?? 'not sent'}`);
  return s as Sent;
}

const deployer = clientForSigner(await loadKeypair(process.env.DEPLOYER_KEYPAIR ?? '~/.config/solana/id.json'));

function registrationFile(id: string, title: string, wallet: string, tesseraAccount: string): Record<string, unknown> {
  const [name, rest] = title.split(': ');
  const what = rest!.charAt(0).toUpperCase() + rest!.slice(1);
  return buildRegistrationFileJson({
    name: `${name} (Tessera demo)`,
    description:
      `${what}. A demo merchant agent on Solana devnet. It sells over A2A and x402, and every payment goes into a Tessera escrow ` +
      `(program ${TESSERA_PROGRAM_ADDRESS}). Its credit file is the account ${tesseraAccount}. It runs from the repository: npm run agents.`,
    image: `${REPO_RAW}/pitch/assets/tessera-logo.png`,
    services: [
      { type: ServiceType.A2A, value: agentCardUrl(id) },
      { type: ServiceType.WALLET, value: wallet },
    ],
    trustModels: [TrustModel.REPUTATION, TrustModel.CRYPTO_ECONOMIC],
    active: true,
    x402Support: true,
  });
}

log.step('Solana Agent Registry (devnet)');
log.info(`registry program ${state.registryProgram}`);

for (const m of MERCHANTS) {
  const kp = web3Keypair(keyPath(m.id));
  const wallet = kp.publicKey.toBase58();
  const tesseraAccount = await agentPdaOf(wallet as Address);
  const uri = `${REPO_RAW}/deployments/registry/${m.id}.json`;
  const file = registrationFile(m.id, m.title, wallet, tesseraAccount);
  if (DRY) {
    console.log(JSON.stringify(file, null, 2));
    continue;
  }
  mkdirSync(FILES_DIR, { recursive: true });
  writeFileSync(resolve(FILES_DIR, `${m.id}.json`), JSON.stringify(file, null, 2) + '\n');

  const sdk = sdkFor(kp);
  let entry = state.agents[m.id];
  if (entry && !(await attempt('agentExists', () => sdk.agentExists(new PublicKey(entry!.asset))))) entry = undefined;

  if (!entry) {
    // Registration costs about 0.0093 SOL in rent, the link about 0.0032.
    const have = (await deployer.rpc.getBalance(wallet as Address).send()).value;
    if (have < 30_000_000n) {
      await deployer.sendTransaction([getTransferSolInstruction({ source: deployer.identity, destination: wallet as Address, amount: lamports(50_000_000n - have) })]);
      log.info(`${m.id.padEnd(6)} topped up to 0.05 SOL for registry rent`);
    }
    const raw = await attempt('registerAgent', () => sdk.registerAgent(uri));
    const r = done('registerAgent', raw);
    const asset = (raw as { asset?: PublicKey }).asset;
    if (!asset) throw new Error('registerAgent returned no asset');
    entry = { asset: asset.toBase58(), wallet, tesseraAccount, uri, registeredTx: r.signature };
    state.agents[m.id] = entry;
    save();
    log.ok(`${m.id.padEnd(6)} registered as ${entry.asset}`);
  } else {
    log.info(`${m.id.padEnd(6)} already registered as ${entry.asset}`);
  }

  const asset = new PublicKey(entry.asset);
  if (!entry.walletSet) {
    done('setAgentWallet', await attempt('setAgentWallet', () => sdk.setAgentWallet(asset, kp)));
    entry.walletSet = true;
    save();
    log.ok(`${m.id.padEnd(6)} agent wallet set to ${wallet}`);
  }
  if (!entry.linked) {
    done('setMetadata', await attempt('setMetadata', () => sdk.setMetadata(asset, 'tessera', tesseraAccount)));
    entry.linked = true;
    save();
    log.ok(`${m.id.padEnd(6)} metadata "tessera" -> ${tesseraAccount}`);
  }
  if (!entry.atom) {
    // ATOM is the registry's own optional scoring engine. Without it the
    // registry keeps the raw feedback but its aggregate fields stay at zero.
    done('enableAtom', await attempt('enableAtom', () => sdk.enableAtom(asset)));
    await attempt('initializeAtomStats', () => sdk.initializeAtomStats(asset)).catch(() => undefined);
    entry.atom = true;
    save();
    log.ok(`${m.id.padEnd(6)} registry scoring (ATOM) enabled`);
  }
}
if (DRY) process.exit(0);

if (MIRROR > 0) {
  log.step(`Mirroring up to ${MIRROR} review(s) per merchant`);
  const buyers = new Map(BUYERS.map((b) => [web3Keypair(keyPath(b.id)).publicKey.toBase58(), b.id]));
  const reviews = await fetchAllReviews(deployer.rpc as never);
  const orders = new Map((await fetchAllOrders(deployer.rpc as never)).map((o) => [o.address as string, o.data]));
  for (const m of MERCHANTS) {
    const entry = state.agents[m.id];
    if (!entry) continue;
    const mine = reviews
      .filter((r) => r.data.subject === entry.wallet && r.data.reviewerIsBuyer && buyers.has(r.data.reviewer) && !state.feedback[r.address])
      .sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
    // one per buyer first, so the copies are not all from the same client
    const picked: typeof mine = [];
    const seen = new Set<string>();
    for (const r of mine) if (!seen.has(r.data.reviewer) && picked.length < MIRROR) (seen.add(r.data.reviewer), picked.push(r));
    for (const r of picked) {
      const order = orders.get(r.data.order);
      if (!order) continue;
      const buyerId = buyers.get(r.data.reviewer)!;
      const tag = r.data.rating >= 3 ? 'x402-resource-delivered' : 'x402-quality-issue';
      const res = done(
        'giveFeedback',
        await attempt('giveFeedback', () =>
          sdkFor(web3Keypair(keyPath(buyerId))).giveFeedback(new PublicKey(entry.asset), {
            value: order.amount,
            valueDecimals: 6,
            score: r.data.rating * 20,
            tag1: tag,
            tag2: 'exact-svm',
            endpoint: `/agents/${m.id}/x402`,
            // proof of payment: the review account exists only because the order settled
            feedbackUri: explorerAddress(r.address),
          }),
        ),
      );
      state.feedback[r.address] = {
        agent: m.id,
        asset: entry.asset,
        client: r.data.reviewer,
        order: r.data.order,
        rating: r.data.rating,
        amount: fromUnits(order.amount),
        tag,
        tx: res.signature,
      };
      save();
      log.ok(`${buyerId.padEnd(6)} -> ${m.id.padEnd(6)} ${r.data.rating}★ on a ${fromUnits(order.amount)} USDC order, tagged ${tag}`);
    }
  }
}

log.step('What the registry now says');
const reader = new SolanaSDK({ cluster: 'devnet', rpcUrl: RPC_URL });
for (const [id, e] of Object.entries(state.agents)) {
  const agent = await attempt('loadAgent', () => reader.loadAgent(new PublicKey(e.asset)));
  const link = await attempt('getMetadata', () => reader.getMetadata(new PublicKey(e.asset), 'tessera')).catch(() => null);
  log.info(`${id.padEnd(6)} asset ${e.asset}`);
  log.info(`       owner ${agent?.getOwnerPublicKey().toBase58()}  wallet ${agent?.getAgentWalletPublicKey()?.toBase58() ?? 'unset'}`);
  log.info(`       uri ${agent?.agent_uri}`);
  log.info(`       metadata tessera = ${link}`);
  const sum = await attempt('getSummary', () => reader.getSummary(new PublicKey(e.asset))).catch(() => null);
  if (sum) log.info(`       registry summary: ${sum.totalFeedbacks} feedback(s), average score ${sum.averageScore}`);
}
log.info(`${Object.keys(state.feedback).length} Tessera review(s) mirrored in total`);
log.info('wrote deployments/registry.json and deployments/registry/*.json (public data only)');
