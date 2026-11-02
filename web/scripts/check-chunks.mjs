// Draws meshed chunks in headless Chromium and checks three things.
// 1. Meshing stays off the page: a made-up world is meshed in workers while the camera walks across chunk boundaries.
//    The page counts the meshing it does on its own thread, which must be none, and its own work per chunk stays small.
//    The same walk with meshing on the page is the comparison: it must count every chunk, so the count is known to work.
// 2. The view distance follows the frame time: with 40 ms of extra work in every frame it starts at 8 chunks and steps
//    down, and the debug panel says so.
// 3. Merged quads (a floor, and a wall whose quads are not square) show the same pixels as the separate blocks they
//    replace, and the check can see a seam: wrapping the tile coordinate before choosing the mip level must fail it.
// Usage: node scripts/check-chunks.mjs <chunks page url> [screenshot dir]. The pages must already be served.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, out] = process.argv.slice(2);
if (!url) throw new Error('usage: check-chunks.mjs <chunks page url> [screenshot dir]');
// The other pages sit next to the one given.
const sibling = (path) => new URL(path, url).href;
if (out) mkdirSync(out, { recursive: true });

// What the page may spend turning one chunk's result into meshes. It does no meshing, only buffers.
const MAX_APPLY_P95_MS = 5;
// A handful of isolated pixels, mostly far away at a grazing angle, land a sampling step apart (up to 0.12% of a view).
// The wrong shader moves 9% to 12%, so the bound sits well between.
const MAX_DIFFERING = 0.0025;
// Wrapping first corrupts thousands of pixels along every tile edge of a view. Far fewer means the check is blind.
const MIN_SEAM_PIXELS = 500;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(page, resultName, shot) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(sibling(page.__path), { waitUntil: 'load', timeout: 120_000 });
  // Software rendering on a shared runner is several times slower than a laptop, so the walk is given time.
  // A page that broke says why instead of timing out blind.
  await page
    .waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 900_000 })
    .catch((e) => {
      throw new Error(
        `${sibling(page.__path)} was not ready: ${e.message}\npage errors: ${errors.join(' | ') || 'none'}`,
      );
    });
  const result = await page.evaluate((name) => window[name], resultName);
  // Kept even when the check fails, which is when the picture is most wanted.
  if (out && shot) await page.screenshot({ path: `${out}/${shot}.png` }).catch(() => {});
  return { result, errors };
}

async function load(path, resultName, shot, size = { width: 960, height: 540 }) {
  const page = await browser.newPage({ viewport: size });
  page.__path = path;
  try {
    return await open(page, resultName, shot);
  } finally {
    await page.close();
  }
}

const fmt = (s) => `p50 ${s.p50.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)} ms`;
let failed = false;
const fail = (msg) => {
  console.error(msg);
  failed = true;
};

const worker = await load('chunks.html', '__chunksResult', 'chunks');
const inline = await load('chunks.html?inline=1', '__chunksResult', 'chunks-inline');
for (const [name, run] of [
  ['worker', worker],
  ['inline', inline],
]) {
  const r = run.result;
  console.log(`${name}: ${r.chunks} chunks, ${r.frames} frames walked`);
  console.log(
    `  mesh ${fmt(r.meshMs)}; on the page ${fmt(r.applyMs)}; meshed on the page: ${r.onPage.calls} chunks, ${r.onPage.ms.toFixed(0)} ms`,
  );
  console.log(`  ${r.drawn} of ${r.wanted} chunks in range at the end are drawn`);
  for (const e of [...r.failures, ...run.errors]) fail(`${name}: ${e}`);
}
// The worker run did no meshing on the page; the page run did all of it, which shows the count can see page meshing.
if (worker.result.onPage.calls !== 0)
  fail(
    `the page meshed ${worker.result.onPage.calls} chunks itself (${worker.result.onPage.ms.toFixed(0)} ms) instead of the workers`,
  );
if (inline.result.onPage.calls < inline.result.chunks)
  fail('the page meshed fewer chunks than it drew, so the count of meshing on the page is not trustworthy');
if (worker.result.applyMs.p95 > MAX_APPLY_P95_MS)
  fail(`the page spent ${worker.result.applyMs.p95.toFixed(1)} ms on a chunk's result, over ${MAX_APPLY_P95_MS}`);
if (worker.result.wanted !== inline.result.wanted) fail('the worker and the page run ended in different places');

const adapt = await load('chunks.html?adapt=1&slow=40', '__chunksResult', 'chunks-adaptive');
const { tiers, panel } = adapt.result;
console.log(`adaptive, 40 ms frames: view distance ${tiers.join(' to ')} chunks`);
console.log(`  panel: ${panel.replaceAll('\n', ' | ')}`);
for (const e of [...adapt.result.failures, ...adapt.errors]) fail(`adaptive: ${e}`);
if (tiers[0] !== 8) fail(`the view distance started at ${tiers[0]}, not 8`);
if (tiers.length < 2 || tiers.at(-1) >= 8) fail('slow frames did not bring the view distance down');
if (!panel.includes(`view ${tiers.at(-1)} chunks`) || !panel.includes('slow'))
  fail('the debug panel does not show the tier change');

const repeat = await load('repeat.html', '__repeatResult', 'repeat', { width: 700, height: 520 });
const seams = await load('repeat.html?gradients=0', '__repeatResult', 'repeat-wrapped', { width: 700, height: 520 });
for (const e of [...repeat.result.failures, ...repeat.errors, ...seams.errors]) fail(e);
for (const [i, view] of repeat.result.views.entries()) {
  const control = seams.result.views[i];
  console.log(
    `${view.name}: ${view.quads} merged quads, ${view.bad} of ${view.pixels} pixels differ from separate blocks`,
  );
  console.log(`  control, wrapped before the mip level: ${control.bad} pixels differ`);
  if (view.bad > view.pixels * MAX_DIFFERING)
    fail(`${view.name}: a merged quad does not look like the blocks it replaces`);
  if (control.bad < MIN_SEAM_PIXELS)
    fail(`${view.name}: the check saw almost no seams when it should, so it cannot tell the shader from a wrong one`);
}

await browser.close();
if (failed) process.exit(1);
