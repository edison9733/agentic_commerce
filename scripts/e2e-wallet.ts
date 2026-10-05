/**
 * Checks the website's checkout with a browser wallet, without installing one.
 *
 * The site finds wallets through the Wallet Standard, the same way it finds
 * Phantom, Solflare or Backpack. This test injects a small Wallet Standard
 * wallet into headless Chrome (an Ed25519 key that signs whatever it is
 * handed, like an extension would after the user clicks approve), then does
 * what a judge would do:
 *
 *   connect the wallet -> get test funds -> buy -> pay into escrow ->
 *   check the delivery -> release -> post a review
 *
 * and finally reads the chain to confirm the order and the review exist.
 *
 * It proves the Wallet Standard path of the site end to end on devnet. It is
 * not a test of any particular wallet extension: those add their own approval
 * screens and their own RPC.
 *
 *   npm run web          (terminal 1)
 *   npm run agents       (terminal 2)
 *   npm run test:wallet
 */
import { chromium } from 'playwright-core';
import { type Address } from '@solana/kit';
import { fetchAllOrders, fetchAllReviews, fromUnits, OrderState, USDC_DEVNET } from '@tessera/sdk';
import { clientForSigner, loadOrCreateKeypair, log, REPO_ROOT, tokenHelpers } from './lib.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SITE = process.env.SITE_URL ?? 'http://localhost:5173';
const HEADED = process.argv.includes('--headed');

// A persistent test key, so a second run reuses the funds of the first.
const KEY_PATH = '.keys/e2e-wallet.json';
const signer = await loadOrCreateKeypair(KEY_PATH);
const seed = (JSON.parse(readFileSync(resolve(REPO_ROOT, KEY_PATH), 'utf8')) as number[]).slice(0, 32);
const chain = clientForSigner(signer);
const tok = tokenHelpers(chain, USDC_DEVNET);
const usdcBefore = await tok.balance(signer.address).catch(() => 0n);
log.step('Wallet Standard checkout');
log.info(`test wallet ${signer.address}, ${fromUnits(usdcBefore)} USDC before`);

/** Runs inside the page, before the app: registers the wallet the way an extension does. */
function injectWallet(seedBytes: number[]) {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes: Uint8Array) => {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = '';
    while (n > 0n) {
      s = B58[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const b of bytes) {
      if (b !== 0) break;
      s = '1' + s;
    }
    return s;
  };
  // PKCS#8 wrapping of a raw Ed25519 seed
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seedBytes]);
  const keys = (async () => {
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    const publicKey = Uint8Array.from(atob(jwk.x!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    return { privateKey, publicKey };
  })();
  const stats = { connected: 0, signed: 0, sent: 0 };
  const listeners = new Set<(change: unknown) => void>();
  let accounts: unknown[] = [];
  const account = async () => {
    const { publicKey } = await keys;
    return { address: b58(publicKey), publicKey, chains: ['solana:devnet'], features: ['solana:signTransaction', 'solana:signAndSendTransaction'], label: 'E2E' };
  };
  const shortVec = (bytes: Uint8Array, at: number): [number, number] => {
    let len = 0;
    let size = 0;
    for (;;) {
      const b = bytes[at + size]!;
      len |= (b & 0x7f) << (size * 7);
      size += 1;
      if (!(b & 0x80)) return [len, size];
    }
  };
  /** Put this wallet's signature into a serialized transaction, legacy or v0. */
  const sign = async (wire: Uint8Array) => {
    const tx = new Uint8Array(wire);
    const [count, size] = shortVec(tx, 0);
    const message = tx.subarray(size + count * 64);
    let at = message[0]! & 0x80 ? 1 : 0;
    const required = message[at]!;
    at += 3;
    const [nkeys, ksize] = shortVec(message, at);
    at += ksize;
    const { privateKey, publicKey } = await keys;
    let slot = -1;
    for (let i = 0; i < Math.min(nkeys, required); i += 1) {
      if (publicKey.every((b, j) => b === message[at + 32 * i + j])) slot = i;
    }
    if (slot < 0) throw new Error('E2E wallet is not a signer of this transaction');
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, message));
    tx.set(signature, size + slot * 64);
    return { tx, signature };
  };
  const wallet = {
    version: '1.0.0',
    name: 'Tessera E2E Wallet',
    icon: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#126b4a"/></svg>')}`,
    chains: ['solana:devnet'],
    get accounts() {
      return accounts;
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          accounts = [await account()];
          stats.connected += 1;
          for (const l of listeners) l({ accounts });
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          accounts = [];
          for (const l of listeners) l({ accounts });
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event: string, listener: (change: unknown) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(
            inputs.map(async (i) => {
              stats.signed += 1;
              return { signedTransaction: (await sign(i.transaction)).tx };
            }),
          ),
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(
            inputs.map(async (i) => {
              const { tx, signature } = await sign(i.transaction);
              const res = await fetch('https://api.devnet.solana.com', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [btoa(String.fromCharCode(...tx)), { encoding: 'base64', preflightCommitment: 'confirmed' }] }),
              });
              const body = (await res.json()) as { error?: { message: string } };
              if (body.error) throw new Error(body.error.message);
              stats.sent += 1;
              return { signature };
            }),
          ),
      },
    },
  };
  (window as unknown as { __e2eWallet: typeof stats }).__e2eWallet = stats;
  const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}

const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
// tsx compiles named inner functions to `__name(fn, 'x')`; the page needs that helper to exist.
await page.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
await page.addInitScript(injectWallet, seed);

const step = async (what: string, run: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    await run();
    log.ok(`${what} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    await page.screenshot({ path: resolve(REPO_ROOT, 'target/e2e-wallet-failure.png') }).catch(() => undefined);
    const shown = await page.evaluate(() => document.querySelector('[style*="fdecea"]')?.textContent ?? '').catch(() => '');
    log.fail(`${what}: ${(e as Error).message.split('\n')[0]}${shown ? `\n       the page says: ${shown}` : ''}`);
    if (errors.length) log.info(`page errors: ${errors.slice(0, 3).join(' | ')}`);
    await browser.close();
    process.exit(1);
  }
};
const says = (re: RegExp, ms: number) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout: ms });

await step('the site lists the injected wallet and connects to it', async () => {
  await page.goto(`${SITE}/#/market`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Tessera E2E Wallet' }).click();
  await says(new RegExp(signer.address.slice(0, 4)), 15_000);
});

await step('the wallet has test funds', async () => {
  if (usdcBefore < 300_000n) {
    await page.getByRole('button', { name: 'Get test funds' }).click();
    await says(/Sent .* test USDC/, 60_000);
  }
  await page.waitForFunction(() => !/\$0\.[01]\d USDC/.test(document.body.innerText), null, { timeout: 60_000 });
});

await step('the buyer pays into escrow and the delivery matches the hash on-chain', async () => {
  await page.locator('button[aria-label^="Buy "]').last().click().catch(async () => page.locator('button:has-text("Buy")').last().click());
  await page.locator('button:has-text("Pay ")').click();
  await says(/In escrow|Released early|Settled/, 150_000);
  await says(/equals the hash on-chain/, 30_000);
});

await step('the buyer releases the money early', async () => {
  const release = page.locator('button:has-text("Release now")');
  if (await release.count()) {
    await release.click();
    await says(/Released early|Settled/, 90_000);
  }
});

await step('the buyer posts a review on-chain', async () => {
  await page.locator('textarea').fill('Bought with a Wallet Standard wallet in an end-to-end test.');
  await page.locator('button:has-text("Post review on-chain")').click();
  await says(/Your review is on-chain/, 90_000);
});

const stats = await page.evaluate(() => (window as unknown as { __e2eWallet: { connected: number; signed: number; sent: number } }).__e2eWallet);
await browser.close();

log.step('What the chain says');
const mine = (await fetchAllOrders(chain.rpc as never)).filter((o) => o.data.buyer === (signer.address as Address)).sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
const latest = mine[0];
const review = latest ? (await fetchAllReviews(chain.rpc as never)).find((r) => r.data.order === latest.address && r.data.reviewer === signer.address) : undefined;
const ok = Boolean(latest && latest.data.state === OrderState.Released && latest.data.buyerReviewed && review);
log.info(`order   ${latest?.address ?? 'none'}  state ${latest ? OrderState[latest.data.state] : '-'}  amount ${latest ? fromUnits(latest.data.amount) : '-'} USDC`);
log.info(`review  ${review?.address ?? 'none'}  ${review ? `${review.data.rating}★ "${review.data.text}"` : ''}`);
log.info(`wallet  connect ${stats.connected}, signTransaction ${stats.signed}, signAndSendTransaction ${stats.sent}`);
if (errors.length) log.warn(`page errors: ${errors.slice(0, 3).join(' | ')}`);
if (!ok) {
  log.fail('the order or the review is not on-chain as expected');
  process.exit(1);
}
log.ok('PASS: a Wallet Standard wallet bought through escrow and reviewed on devnet');
