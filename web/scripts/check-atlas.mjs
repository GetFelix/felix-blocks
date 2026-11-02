// Renders every atlas tile at a distance in headless Chromium and fails if one differs from the same tile drawn from a texture of its own.
// It also builds the atlas with no padding and fails if that does NOT bleed, which proves the check can see bleeding.
// Usage: node scripts/check-atlas.mjs <atlas page url> [screenshot dir]. The page must already be served.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, out] = process.argv.slice(2);
if (!url) throw new Error('usage: check-atlas.mjs <atlas page url> [screenshot dir]');
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function run(query, shot) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url + query, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 120_000 });
  const result = await page.evaluate(() => window.__atlasResult);
  if (out && shot) await page.screenshot({ path: `${out}/${shot}.png`, fullPage: true });
  await page.close();
  return { result, errors };
}

const padded = await run('', 'atlas');
const bare = await run('?pad=0', 'atlas-unpadded');
await browser.close();

const { result: ok } = padded;
console.log(`padded (${ok.pad} px): ${ok.quads} quads, ${ok.bad.length} with bleeding`);
for (const b of ok.bad) console.error(`  ${b.tile} at ${b.size} px: ${b.pixels} pixels`);
console.log(`unpadded control: ${bare.result.bad.length} quads with bleeding`);

let failed = ok.failures.length > 0 || ok.bad.length > 0 || padded.errors.length > 0;
for (const e of [...ok.failures, ...padded.errors, ...bare.errors]) console.error(e);
if (bare.result.bad.length < 10) {
  console.error('the check saw almost no bleeding without padding, so it cannot tell padding from none');
  failed = true;
}
if (failed) process.exit(1);
