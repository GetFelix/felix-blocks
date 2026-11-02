// Joins a world with 500 edited chunks: one player edits 500 chunks, then a second joins. Reading the world's info and
// receiving the 500 chunks, plus the page taking them in, must fit in two seconds, and the second player's page must
// have every edit. The page's first frame is printed but not judged: headless Chromium draws it in software, and what it
// costs there says nothing about a real GPU.
// Usage: node scripts/check-load.mjs <play page url> <world>. The page must be served and the dev stack up; the world is
// made with `blocks-tool create` and lets ana and ben in. Run it against a world nobody has built in.
import { GatewayClient } from 'felix-gateway-client';
import { GATEWAY, idToken, launch, openAs, stopDrawing } from './stack.mjs';

const [url, world] = process.argv.slice(2);
if (!world) throw new Error('usage: check-load.mjs <play page url> <world>');
const CHUNKS = 500;
const BUDGET_MS = 2000;

const browser = await launch();
const errors = [];
let failure = null;
try {
  const ana = await openAs(browser, url, world, 'ana', errors);
  // One cell in the middle of each of 500 chunks (25 x 20 of them, one layer up), each set to a block that is not there.
  const edited = await ana.evaluate((count) => {
    const done = [];
    for (let i = 0; i < count; i++) {
      const [x, y, z] = [(i % 25) * 16 + 8, 3 * 16 + 8, Math.floor(i / 25) * 16 + 8];
      const id = window.__edit.block(x, y, z) === 5 ? 6 : 5;
      if (!window.__edit.set(x, y, z, id)) throw new Error(`no change at ${x},${y},${z}`);
      done.push([x, y, z, id]);
    }
    return done;
  }, CHUNKS);
  await ana.evaluate(() => window.__edit.saved());
  if (await ana.evaluate(() => window.__edit.dirty())) throw new Error('500 chunks were not saved in time');
  if (await ana.evaluate(() => window.__edit.saving && document.getElementById('status').className === 'fail'))
    throw new Error('saving the chunks failed');
  console.log(`${edited.length} chunks edited and saved`);
  await stopDrawing(ana);

  // What Felix costs: join as ben, read the info and ask for the chunks, as the page does, until all 500 have arrived.
  // Measured here and not in the page, whose software-rendered scene setup holds up the event loop for seconds.
  const token = await idToken('ben');
  const started = performance.now();
  const client = await GatewayClient.connect(GATEWAY, { token, world }, ['cache_versions', 'rate_limited']);
  const arrived = new Promise((resolve) => {
    client.onCacheEntries = (cache, entries) => cache === 'chunks' && resolve(entries.length);
  });
  if (!(await client.cacheGet('info', 'info'))) throw new Error(`world ${world} has no info`);
  client.cacheWatch('chunks');
  const count = await arrived;
  const fetching = performance.now() - started;
  client.close();
  if (count < CHUNKS) throw new Error(`the watch answered with ${count} chunks, not ${CHUNKS}`);

  // What the page costs once they arrive: taking them in, and what it shows.
  const ben = await openAs(browser, url, world, 'ben', errors);
  const missing = await ben.evaluate(
    (cells) => cells.filter(([x, y, z, id]) => window.__edit.block(x, y, z) !== id).length,
    edited,
  );
  const timing = await ben.evaluate(() => window.__timing);
  const taking = timing.ingested - timing.entries;
  if (!Number.isFinite(taking))
    throw new Error(`the page never reported taking the chunks in: ${JSON.stringify(timing)}`);
  console.log(
    `${count} saved chunks: ${Math.round(fetching)} ms to join and receive them, ${Math.round(taking)} ms for the page to ` +
      `take them in; its first frame came at ${Math.round(timing.firstFrame)} ms (software rendering, not judged)`,
  );
  if (missing > 0) throw new Error(`${missing} of ${edited.length} edits are missing for the second player`);
  if (fetching + taking > BUDGET_MS) {
    throw new Error(`joining took ${Math.round(fetching + taking)} ms, over ${BUDGET_MS}`);
  }
} catch (e) {
  failure = String(e);
}
await browser.close();
if (errors.length) failure = `${failure ? `${failure}; ` : ''}page errors: ${errors.slice(0, 5).join('; ')}`;
if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log('a world with 500 edited chunks loads in time');
