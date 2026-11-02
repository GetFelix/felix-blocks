// Plays offline: the page opens a world kept in the browser with no connection to Felix, a placed block is kept, and
// after a reload the world is the same and the block is still there, even when the reload asks for another seed.
// Usage: node scripts/check-offline.mjs <play page url>. The page must already be served. Needs no Felix.
import { chromium } from 'playwright';

const [url] = process.argv.slice(2);
if (!url) throw new Error('usage: check-offline.mjs <play page url>');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// A fresh context has an empty IndexedDB, so the world below is new.
const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
const errors = [];
const sockets = [];
const open = async (query) => {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const where = new URL(url);
  where.search = query;
  await page.goto(where.href, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 300_000 });
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  if (!status.includes('(offline)')) throw new Error(`the page is not offline: ${status}`);
  await page.waitForFunction(() => window.__play().onGround, null, { polling: 100, timeout: 120_000 });
  return page;
};
// The terrain around the player's start, as a fingerprint: same seed, same blocks.
const terrain = (page) =>
  page.evaluate(() => {
    const { x, z } = window.__play();
    let sum = 0;
    for (let dy = 0; dy < 90; dy++)
      for (let d = -6; d <= 6; d++)
        sum = (sum * 31 + window.__edit.block(Math.floor(x) + d, dy, Math.floor(z) - d)) >>> 0;
    return sum;
  });

let failure = null;
try {
  let page = await open('offline=check&seed=11');
  const before = await terrain(page);
  const feet = await page.evaluate(() => window.__play());
  const cell = [Math.floor(feet.x) + 3, Math.floor(feet.y) + 2, Math.floor(feet.z) + 3];
  const placed = await page.evaluate(([x, y, z]) => {
    const id = window.__edit.block(x, y, z) === 5 ? 6 : 5;
    window.__edit.set(x, y, z, id);
    return window.__edit.saved().then(() => id);
  }, cell);
  console.log('placed a block in an offline world');
  await page.close();

  // The reload asks for another seed; the world keeps the one it was made with.
  page = await open('offline=check&seed=3');
  const after = await page.evaluate(([x, y, z]) => window.__edit.block(x, y, z), cell);
  if (after !== placed) throw new Error(`the placed block is ${after} after a reload, not ${placed}`);
  // The fingerprint's cells are not the placed block's, so the placed block does not change it.
  if ((await terrain(page)) !== before) throw new Error('the terrain is not the one the world was made with');
  console.log('after a reload the block and the terrain are the same');

  // Another name is another world, made from its own seed.
  const other = await open('offline=other&seed=3');
  if ((await terrain(other)) === before) throw new Error('two offline worlds are the same world');
  if (sockets.length > 0) throw new Error(`the page opened ${sockets.length} connection(s): ${sockets.join(', ')}`);
} catch (e) {
  failure = String(e);
}
await browser.close();
if (errors.length) failure = `${failure ? `${failure}; ` : ''}page errors: ${errors.slice(0, 5).join('; ')}`;
if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log('an offline world is kept between visits');
