// Opens the asset page and fails if a tile or character does not load, the page logs an error, or the page loaded fewer
// tiles than are on disk. Usage: node scripts/check-assets.mjs <page url>. The page must already be served.
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [url] = process.argv.slice(2);
if (!url) throw new Error('usage: check-assets.mjs <asset page url>');

// What is on disk, counted without the app's table.
const root = new URL('../assets/', import.meta.url);
const count = (dir, ext) => readdirSync(new URL(dir, root)).filter((f) => f.endsWith(ext)).length;
const tilesOnDisk = count('voxel-pack/tiles/', '.png');
const charactersOnDisk = count('blocky-characters/', '.glb');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 120_000 });
const result = await page.evaluate(() => window.__result);
await browser.close();

console.log(
  `${result.tiles.loaded} of ${result.tiles.total} tiles loaded (${tilesOnDisk} on disk), ` +
    `${result.characters.loaded} of ${result.characters.total} characters (${charactersOnDisk} on disk)`,
);
for (const f of result.failures) console.error(f);
for (const e of errors) console.error(`console: ${e}`);
const bad =
  result.failures.length ||
  errors.length ||
  result.tiles.total !== tilesOnDisk ||
  result.tiles.loaded !== tilesOnDisk ||
  result.characters.total !== charactersOnDisk ||
  result.characters.loaded !== charactersOnDisk;
if (bad) process.exit(1);
