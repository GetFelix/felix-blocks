// Draws meshed chunks in headless Chromium and checks two things.
// 1. Meshing stays off the page: a made-up world is meshed in workers while the camera walks across chunk boundaries,
//    and the page's own work per chunk stays small. The same walk with meshing on the page is the comparison.
// 2. A merged quad shows the same pixels as the separate blocks it replaces, and the check can see a seam: wrapping the
//    tile coordinate before choosing the mip level must fail it.
// Usage: node scripts/check-chunks.mjs <base url> [screenshot dir]. The pages must already be served.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
if (!base) throw new Error('usage: check-chunks.mjs <base url, ending in /> [screenshot dir]');
if (out) mkdirSync(out, { recursive: true });

// What the page may spend turning one chunk's result into meshes. It does no meshing, only buffers.
const MAX_APPLY_P95_MS = 5;
// A few pixels along a tile edge land a rounding step apart. A wrong shader moves thousands.
const MAX_DIFFERING = 0.001;
// Of about 56,000 covered pixels, wrapping first corrupts thousands along every tile edge. Far fewer means the check is blind.
const MIN_SEAM_PIXELS = 500;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(page, resultName, shot) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + page.__path, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 240_000 });
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
    `  mesh ${fmt(r.meshMs)}; on the page ${fmt(r.applyMs)}; page blocked by meshing ${r.blockedMs.toFixed(0)} ms`,
  );
  for (const e of [...r.failures, ...run.errors]) fail(`${name}: ${e}`);
}
if (worker.result.blockedMs !== 0) fail('meshing in the worker blocked the page');
if (worker.result.applyMs.p95 > MAX_APPLY_P95_MS)
  fail(`the page spent ${worker.result.applyMs.p95.toFixed(1)} ms on a chunk's result, over ${MAX_APPLY_P95_MS}`);
if (worker.result.chunks !== inline.result.chunks) fail('the worker and the page meshed different numbers of chunks');

const repeat = await load('repeat.html', '__repeatResult', 'repeat', { width: 700, height: 520 });
const seams = await load('repeat.html?gradients=0', '__repeatResult', 'repeat-wrapped', { width: 700, height: 520 });
console.log(`merged quad: ${repeat.result.bad} of ${repeat.result.pixels} pixels differ from separate blocks`);
console.log(`control, wrapped before the mip level: ${seams.result.bad} pixels differ`);
for (const e of [...repeat.result.failures, ...repeat.errors, ...seams.errors]) fail(e);
if (repeat.result.bad > repeat.result.pixels * MAX_DIFFERING)
  fail('a merged quad does not look like the blocks it replaces');
if (seams.result.bad < MIN_SEAM_PIXELS)
  fail('the check saw almost no seams when it should, so it cannot tell the shader from a wrong one');

await browser.close();
if (failed) process.exit(1);
