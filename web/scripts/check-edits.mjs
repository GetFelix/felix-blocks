// Builds in a world saved to Felix, with two players in two pages: what one places is saved, a second page opened
// afterwards has it, an edit by the second shows up live in the first, and after a reload the first has both.
// Usage: node scripts/check-edits.mjs <play page url> [world] — the page must be served and the dev stack up
// (dev/up.sh, which also serves the provider that mints the players' tokens); the world is `demo` by default and must let ana and ben in.
import { chromium } from 'playwright';

const [url, world = 'demo'] = process.argv.slice(2);
if (!url) throw new Error('usage: check-edits.mjs <play page url> [world]');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const IDP = process.env.BLOCKS_ISSUER ?? 'http://127.0.0.1:9400';
const idToken = async (user) => {
  const response = await fetch(`${IDP}/token?sub=${user}&aud=felix-blocks`);
  if (!response.ok) throw new Error(`the provider at ${IDP} answered ${response.status}`);
  return (await response.json()).id_token;
};
const open = async (user) => {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => errors.push(`${user}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${user}: ${m.text()}`));
  const where = new URL(url);
  where.searchParams.set('gateway', 'ws://127.0.0.1:8787/ws');
  where.searchParams.set('world', world);
  where.searchParams.set('token', await idToken(user));
  await page.goto(where.href, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 300_000 });
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  if (!(await page.evaluate(() => window.__edit?.saving))) throw new Error(`${user}'s page is not saving: ${status}`);
  return page;
};
const block = (page, cell) => page.evaluate(([x, y, z]) => window.__edit.block(x, y, z), cell);
const until = (page, what, cell, id) =>
  page
    .waitForFunction(([[x, y, z], want]) => window.__edit.block(x, y, z) === want, [cell, id], {
      polling: 100,
      timeout: 60_000,
    })
    .catch(() => {
      throw new Error(`${what}: the block never became ${id}`);
    });

let failure = null;
try {
  let ana = await open('ana');
  await ana.waitForFunction(() => window.__play().onGround, null, { polling: 100, timeout: 120_000 });
  const feet = await ana.evaluate(() => window.__play());
  // Two cells of one chunk (the chunk's other cells stay generated), in the air above the landing place.
  const base = [Math.floor(feet.x) + 4, Math.floor(feet.y) + 3, Math.floor(feet.z) + 4];
  const first = base;
  const second = [base[0] + 1, base[1], base[2]];
  if (first[0] >> 4 !== second[0] >> 4) (first[0] -= 2), (second[0] -= 2);
  if ((await block(ana, first)) !== 0 || (await block(ana, second)) !== 0) throw new Error('the cells are not air');

  await ana.evaluate(([x, y, z]) => window.__edit.set(x, y, z, 5), first);
  await ana.evaluate(() => window.__edit.saved());
  console.log('ana placed a block and it was saved');

  const ben = await open('ben');
  await until(ben, 'ben loading the world', first, 5);
  console.log('ben saw it on joining');
  await ben.evaluate(([x, y, z]) => window.__edit.set(x, y, z, 6), second);
  await ben.evaluate(() => window.__edit.saved());
  await until(ana, 'ana watching ben', second, 6);
  console.log('ana saw ben build live');

  await ana.close();
  ana = await open('ana');
  await until(ana, 'ana after a reload', first, 5);
  await until(ana, 'ana after a reload', second, 6);
  console.log('after a reload both blocks are there');
} catch (e) {
  failure = String(e);
}
await browser.close();
if (errors.length) failure = `${failure ? `${failure}; ` : ''}page errors: ${errors.join('; ')}`;
if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log('edits are saved and shared');
