/**
 * Still images for the submission: the logo as PNG, a cover image of the
 * site, every slide of the three decks, and each deck as a PDF.
 *
 *   npm run web     (the site must be running)
 *   node pitch/stills.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const site = process.env.SITE ?? 'http://localhost:5173';
const assets = resolve(here, 'assets');
const out = resolve(here, 'out');
mkdirSync(assets, { recursive: true });
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// logo
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  const svg = readFileSync(join(assets, 'tessera-logo.svg'), 'utf8');
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await page.screenshot({ path: join(assets, 'tessera-logo.png'), omitBackground: true });
  await page.close();
}

// cover: the hero with the live network in it
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${site}/#/`);
  await pause(9000);
  await page.evaluate(() => window.scrollTo(0, 430));
  await pause(2500);
  await page.screenshot({ path: join(assets, 'tessera-cover.png') });
  await page.close();
}

// decks
for (const name of ['pitch', 'demo', 'update']) {
  const source = readFileSync(resolve(here, `../apps/web/src/deck/${name}.tsx`), 'utf8');
  const count = (source.match(/\n    id: '/g) ?? []).length;
  const dir = join(out, `${name}-slides`);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${site}/#/deck/${name}?clean=1&i=0`);
  await pause(9000); // let the chain data arrive once
  const files = [];
  for (let i = 0; i < count; i += 1) {
    await page.evaluate((k) => {
      window.location.hash = window.location.hash.replace(/i=\d+/, `i=${k}`);
    }, i);
    await pause(name === 'demo' ? 6500 : 4200);
    const file = join(dir, `${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await page.close();

  const pdf = await browser.newPage();
  const imgs = files.map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:1600px;height:900px;display:block;page-break-after:always">`).join('');
  await pdf.setContent(`<body style="margin:0">${imgs}</body>`);
  await pdf.pdf({ path: join(out, `tessera-${name}-deck.pdf`), width: '1600px', height: '900px', printBackground: true });
  await pdf.close();
  console.log(`${name}: ${files.length} slides -> ${dir}, tessera-${name}-deck.pdf`);
}

await browser.close();
writeFileSync(join(out, 'README.txt'), 'Rendered by pitch/render.mjs and pitch/stills.mjs. Regenerate rather than edit.\n');
