// Builds in a world saved to Felix, with two players in two pages: what one places is saved, a second page opened
// afterwards has it, an edit by the second shows up live in the first, and after a reload the first has both.
// Usage: node scripts/check-edits.mjs <play page url> <world>. The page must be served and the dev stack up
// (dev/up.sh, which also serves the provider that mints the players' tokens). The world must be made with
// `blocks-tool create`, so it has its info, and let ana and ben in.
import { launch, openAs, stopDrawing } from './stack.mjs';

const [url, world] = process.argv.slice(2);
if (!world) throw new Error('usage: check-edits.mjs <play page url> <world>');

// Joining the world and reading its info, measured in the page before its scene setup, which software rendering slows.
const JOIN_BUDGET_MS = 5000;

const browser = await launch();
const errors = [];
const open = (user) => openAs(browser, url, world, user, errors);
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

  await stopDrawing(ana);
  const ben = await open('ben');
  const { joinMs } = await ben.evaluate(() => window.__timing);
  if (!(joinMs < JOIN_BUDGET_MS)) throw new Error(`ben joined in ${joinMs} ms, over ${JOIN_BUDGET_MS} ms`);
  await until(ben, 'ben loading the world', first, 5);
  console.log(`ben joined in ${Math.round(joinMs)} ms and saw it`);
  await ben.evaluate(([x, y, z]) => window.__edit.set(x, y, z, 6), second);
  await ben.evaluate(() => window.__edit.saved());
  await until(ana, 'ana watching ben', second, 6);
  console.log('ana saw ben build live');

  await stopDrawing(ben);
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
