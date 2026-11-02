import { expect, test } from 'vitest';
import { BUDGET_MS, fogFor, MAX_TIER, MIN_TIER, ViewDistance } from './view-distance';

/** Feeds `ms` of frames at `frameMs` each, or until the tier changes. Returns the changes, which is at most one. */
function run(v: ViewDistance, frameMs: number, ms: number) {
  for (let t = 0; t < ms; t += frameMs) {
    const c = v.record(frameMs);
    if (c) return [c];
  }
  return [];
}

test('a steady 60 fps holds the tier for a while, then tries one more', () => {
  const v = new ViewDistance({ start: 8 });
  expect(run(v, BUDGET_MS, 4000)).toEqual([]);
  const changes = run(v, BUDGET_MS, 4000);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ from: 8, to: 9, reason: 'steady' });
});

test('frames a little over the budget step down one tier', () => {
  const v = new ViewDistance({ start: 8 });
  const changes = run(v, 19, 3000);
  expect(changes[0]).toMatchObject({ from: 8, to: 7, reason: 'slow' });
});

test('very slow frames step down to the tier whose cost fits, in one go', () => {
  const v = new ViewDistance({ start: 12 });
  // 12 chunks at 40 ms: the frame cost follows tier squared, so about 7 chunks fit in 16.7 ms.
  const changes = run(v, 40, 3000);
  expect(changes[0]).toMatchObject({ from: 12, to: 7, reason: 'slow' });
});

test('it never leaves the tiers, however slow or fast the frames are', () => {
  const slow = new ViewDistance({ start: 5 });
  for (let i = 0; i < 2000; i++) slow.record(200);
  expect(slow.tier).toBe(MIN_TIER);
  const fast = new ViewDistance({ start: 11 });
  for (let i = 0; i < 100000; i++) fast.record(8);
  expect(fast.tier).toBe(MAX_TIER);
});

test('a spike while the new distance loads does not count', () => {
  const v = new ViewDistance({ start: 8 });
  run(v, 19, 3000);
  expect(v.tier).toBe(7);
  // Twenty bad frames right after a change are the chunks loading in. Then the frames are good.
  for (let i = 0; i < 20; i++) expect(v.record(80)).toBeNull();
  expect(run(v, BUDGET_MS, 3000)).toEqual([]);
  expect(v.tier).toBe(7);
});

test('a step up that has to be undone makes the next one wait longer', () => {
  const v = new ViewDistance({ start: 8 });
  run(v, BUDGET_MS, 8000);
  expect(v.tier).toBe(9);
  // The extra distance is too much: back down at once.
  expect(run(v, 19, 3000)[0]).toMatchObject({ from: 9, to: 8 });
  // Frames recover. A second try is not made for 30 seconds from the first step up, not the usual 15.
  const early = run(v, BUDGET_MS, 20000);
  expect(early).toEqual([]);
  const later = run(v, BUDGET_MS, 20000);
  expect(later[0]).toMatchObject({ from: 8, to: 9 });
});

test('every change is kept with the time and the mean that caused it', () => {
  const v = new ViewDistance({ start: 8 });
  run(v, 19, 3000);
  expect(v.changes).toHaveLength(1);
  expect(v.changes[0]!.meanMs).toBeCloseTo(19);
  expect(v.changes[0]!.at).toBeGreaterThan(0);
});

test('the fog finishes inside the loaded chunks', () => {
  expect(fogFor(8)).toEqual({ near: 112 * 0.37, far: 112 });
  expect(fogFor(4).far).toBeLessThan(4 * 16);
});
