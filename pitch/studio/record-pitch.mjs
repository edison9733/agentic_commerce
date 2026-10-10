/**
 * A rehearsal version of the pitch video: the pitch script as large subtitles
 * over the real website, with a frame where your camera goes. Record yourself
 * over it, or read along while you practise. No voice.
 *
 *   node pitch/studio/record-pitch.mjs [--site URL] [--wpm 135]
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { burn, pause, srt } from './film.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, f) => (argv.indexOf(`--${n}`) > -1 ? argv[argv.indexOf(`--${n}`) + 1] : f);
const site = opt('site', 'http://localhost:5173');
const wpm = Number(opt('wpm', 135));
const name = 'tessera-pitch-rehearsal';
const work = join(here, '.run/video', name);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// The pitch script from docs/VIDEO-GUIDE.md, one subtitle per sentence.
const SCRIPT = [
  "Hi, I'm Edison Liu.",
  'I study electronic and computer engineering at the ZJU-UIUC Institute.',
  'I build working systems from start to finish, from Arduino hardware to software.',
  'AI agents are starting to pay each other with x402.',
  'Once an x402 payment settles, there is no chargeback.',
  'So agents mostly move small amounts.',
  'Tessera puts each payment in an escrow on Solana.',
  'An on-chain credit score decides how long the money waits.',
  'A fresh wallet waits. Two Trusted-tier wallets can settle instantly.',
  'The score comes only from orders that really settled, so faking it costs real fees and time.',
  'Security research is my interest, so I started from the threat model: who steals what, and at what cost.',
  'I audited my own work twice.',
  'The second time I found a critical bug: a merchant could cancel and reopen an order to take a buyer’s payment.',
  'I fixed it and wrote a test that proves it.',
  'I build with Claude Code. I set the requirements and the threat model, and I check the results.',
  'The code and the tests are in the public repository.',
  'It runs on devnet with test money. There are no outside users yet, and it is not audited.',
  'Next, I want to talk to x402 sellers who would charge more than cents.',
  'I intend to keep building it. Thank you.',
];
let at = 2.5;
const cues = SCRIPT.map((text) => {
  const c = { at, text };
  at += (text.split(/\s+/).length / wpm) * 60 + 0.45;
  return c;
});
const total = at + 2;

function FRAME() {
  const install = () => {
    if (document.getElementById('__cam')) return;
    const cam = document.createElement('div');
    cam.id = '__cam';
    cam.innerHTML = '<div style="font:600 15px Inter,system-ui;letter-spacing:.08em;text-transform:uppercase">Your camera here</div><div style="font:400 13px Inter,system-ui;margin-top:6px;opacity:.8">rehearsal version · record yourself</div>';
    Object.assign(cam.style, {
      position: 'fixed', right: '28px', top: '78px', width: '360px', height: '220px', zIndex: '2147483647', pointerEvents: 'none',
      border: '3px dashed rgba(185,248,218,.95)', borderRadius: '18px', background: 'rgba(15,17,13,.82)', color: '#f4f1e6',
      display: 'grid', placeContent: 'center', textAlign: 'center',
    });
    const bar = document.createElement('div');
    Object.assign(bar.style, { position: 'fixed', left: '0', bottom: '0', height: '6px', width: '0', background: '#2f9e73', zIndex: '2147483647', transition: 'width 1s linear' });
    bar.id = '__bar';
    document.documentElement.append(cam, bar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  new MutationObserver(() => document.getElementById('__cam') || install()).observe(document, { childList: true, subtree: true });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: work, size: { width: 1920, height: 1080 } } });
await context.addInitScript(FRAME);
const page = await context.newPage();
const t0 = Date.now();
// Title cards sit over the live site, so nothing reloads between scenes.
const card = (title, sub) =>
  page.evaluate(([t, s]) => {
    document.getElementById('__card')?.remove();
    const d = document.createElement('div');
    d.id = '__card';
    d.innerHTML = `<div style="text-align:center"><div style="font:500 64px Georgia,serif">${t}</div><div style="font:400 24px Inter,system-ui;color:#b9f8da;margin-top:16px">${s}</div></div>`;
    Object.assign(d.style, { position: 'fixed', inset: '0', zIndex: '2147483640', background: '#0b0c0a', color: '#f4f1e6', display: 'grid', placeItems: 'center', opacity: '0', transition: 'opacity .6s ease' });
    document.body.appendChild(d);
    requestAnimationFrame(() => (d.style.opacity = '1'));
  }, [title, sub]);
const uncard = () => page.evaluate(() => { const d = document.getElementById('__card'); if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 650); } });
const hash = (h) => page.evaluate((v) => (window.location.hash = v), h);

await page.goto(`${site}/#/`);
await page.waitForFunction(() => document.body.innerText.length > 600, null, { timeout: 30_000 }).catch(() => {});

// Start the clock once the title card is up.
await card('Edison Liu', 'Tessera · the credit layer for agentic commerce');
await pause(500);
const start = (Date.now() - t0) / 1000;
const progress = setInterval(() => {
  const k = Math.min(1, ((Date.now() - t0) / 1000 - start) / total);
  page.evaluate((w) => { const b = document.getElementById('__bar'); if (b) b.style.width = `${w * 100}%`; }, k).catch(() => {});
}, 1000);
const until = async (sec) => {
  const left = start + sec - (Date.now() - t0) / 1000;
  if (left > 0) await pause(left * 1000);
};
const scroll = (y) => page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y);

await until(16);
await hash('#/network');
await uncard();
await until(30);
await hash('#/agents');
await until(36);
await page.locator('tbody tr').first().click().catch(() => {});
await until(42);
await scroll(700);
await until(52);
await hash('#/formula');
await until(56);
await page.getByRole('button', { name: /^Sells to itself/ }).first().scrollIntoViewIfNeeded().catch(() => {});
await page.getByRole('button', { name: /^Sells to itself/ }).first().click().catch(() => {});
await until(64);
await page.getByRole('button', { name: /^Busy and well reviewed/ }).first().click().catch(() => {});
await until(72);
await card('Two internal audits', 'A critical order-swap bug found, fixed, and covered by a test');
await until(84);
await hash('#/market');
await uncard();
await until(96);
await card('Devnet · test money · no outside users yet', 'github.com/edison9733/agentic_commerce');
await until(total);
clearInterval(progress);
const end = (Date.now() - t0) / 1000;
await page.close();
await context.close();
await browser.close();

const raw = readdirSync(work).find((f) => f.endsWith('.webm'));
renameSync(join(work, raw), join(work, 'raw.webm'));
const out = join(repo, 'pitch/out');
writeFileSync(join(out, `${name}.srt`), srt(cues, end - start));
burn(join(work, 'raw.webm'), join(out, `${name}.srt`), join(out, `${name}.mp4`), start);
console.log(`${name}: ${(end - start).toFixed(1)} s, ${cues.length} subtitles, script ${total.toFixed(1)} s`);
