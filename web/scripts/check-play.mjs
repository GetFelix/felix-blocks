// Plays the game page in headless Chromium with the keyboard: the player lands on the generated terrain, walks while
// W is held, flies up and comes back down, and the page raises no errors. Frames are software-rendered and slow
// here, so every wait is on what the player did, never on time passed.
// Usage: node scripts/check-play.mjs <play page url> [screenshot dir]. The page must already be served.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, out] = process.argv.slice(2);
if (!url) throw new Error('usage: check-play.mjs <play page url> [screenshot dir]');
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const state = () => page.evaluate(() => window.__play());
// Screenshots are only there for a person to look at; no check reads them. Capture waits for a rendered frame, and on a
// busy software-rendered CI runner that frame can take longer than the default 30 s, so give it two minutes and, if it
// still does not come, warn instead of failing a run whose assertions held.
async function shot(name) {
  if (!out) return;
  try {
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 120_000 });
  } catch (e) {
    console.warn(`no screenshot ${name}: ${String(e).split('\n')[0]}`);
  }
}

/** Waits until `test(state, arg)` holds in the page; says what the player was doing if it never does. */
async function until(what, test, arg = null) {
  try {
    await page.waitForFunction(
      ([src, a]) => {
        const status = document.getElementById('status');
        if (status?.className === 'fail') throw new Error(`the page failed: ${status.textContent}`);
        return window.__play ? new Function('s', 'a', `return (${src})(s, a)`)(window.__play(), a) : false;
      },
      [test.toString(), arg],
      { polling: 100, timeout: 180_000 },
    );
  } catch (e) {
    if (String(e).includes('the page failed')) throw e;
    throw new Error(
      `timed out waiting for ${what}; the player was at ${JSON.stringify(await state().catch(() => null))}`,
    );
  }
}

let failure = null;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 300_000 });
  await until('the player to land', (s) => s.onGround);
  const landed = await state();
  console.log(`landed at ${landed.x.toFixed(1)}, ${landed.y.toFixed(1)}, ${landed.z.toFixed(1)}`);
  if (landed.y < 1 || landed.y > 130) throw new Error(`landed at a height of ${landed.y}`);
  await shot('landed');

  // The player starts facing -z, so W walks north. It only moves if the keys reach the physics. The seed 7 world has
  // open ground there; a generator change that puts a tree in the way needs another seed or a jump held here.
  await page.keyboard.down('KeyW');
  await until('a walk of 6 blocks', (s, from) => Math.hypot(s.x - from.x, s.z - from.z) > 6, landed);
  await page.keyboard.up('KeyW');
  console.log('walked');
  await shot('walked');

  await page.keyboard.press('KeyF');
  await until('flight', (s) => s.flying);
  const flying = await state();
  await page.keyboard.down('Space');
  await until('a climb of 5 blocks', (s, from) => s.y > from.y + 5, flying);
  await page.keyboard.up('Space');
  await page.keyboard.down('ShiftLeft');
  await until('the landing that ends flight', (s) => !s.flying && s.onGround);
  await page.keyboard.up('ShiftLeft');
  console.log('flew up and came down');
} catch (e) {
  failure = String(e);
}
await shot('end');
await browser.close();
if (errors.length) failure = `${failure ? `${failure}; ` : ''}page errors: ${errors.join('; ')}`;
if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log('the player landed, walked and flew');
