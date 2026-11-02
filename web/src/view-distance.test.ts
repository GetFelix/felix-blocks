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
  run(v, BUDGET_MS, 8000);
  expect(v.tier).toBe(9);
  // Twenty bad frames right after a step up are the chunks loading in. Then the frames are good.
  for (let i = 0; i < 20; i++) expect(v.record(80)).toBeNull();
  expect(run(v, BUDGET_MS, 3000)).toEqual([]);
  expect(v.tier).toBe(9);
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

/** Steady frames up to one step up, then slow ones until it is undone. Returns the undoing change. */
function failedStepUp(v: ViewDistance) {
  expect(run(v, BUDGET_MS, 300000)[0]).toMatchObject({ reason: 'steady' });
  return run(v, 19, 3000)[0];
}

test('two step ups in a row are one wait apart, and the second needs its own 5 seconds', () => {
  const v = new ViewDistance({ start: 8 });
  expect(run(v, BUDGET_MS, 8000)[0]).toMatchObject({ from: 8, to: 9 });
  // 15 seconds from the first step up, not a moment sooner.
  expect(run(v, BUDGET_MS, 13000)).toEqual([]);
  expect(run(v, BUDGET_MS, 4000)[0]).toMatchObject({ from: 9, to: 10, reason: 'steady' });
});

test('a step up undone over two tiers doubles the wait once', () => {
  const v = new ViewDistance({ start: 9 });
  run(v, BUDGET_MS, 10000);
  expect(v.tier).toBe(10);
  expect(run(v, 19, 3000)[0]).toMatchObject({ from: 10, to: 9 });
  expect(v.retryAfterMs).toBe(30000);
  // The same slowness takes the next tier too; it is one failed step up, not two.
  expect(run(v, 19, 3000)[0]).toMatchObject({ from: 9, to: 8 });
  expect(v.retryAfterMs).toBe(30000);
});

test('a slow step down that is not undoing a step up leaves the wait alone', () => {
  const v = new ViewDistance({ start: 8 });
  run(v, 19, 3000);
  run(v, 19, 3000);
  expect(v.retryAfterMs).toBe(15000);
});

test('the wait is capped, and halves each time a step up holds', () => {
  const v = new ViewDistance({ start: 5 });
  for (let i = 0; i < 8; i++) {
    failedStepUp(v);
    // Back to 5 for the next try, whatever the undo left.
    while (v.tier > 5) run(v, 19, 3000);
  }
  expect(v.retryAfterMs).toBe(120000);
  // A step up that survives its whole wait is halved at the next step up.
  const held = new ViewDistance({ start: 5 });
  failedStepUp(held);
  expect(held.retryAfterMs).toBe(30000);
  const up = run(held, BUDGET_MS, 120000);
  expect(up[0]).toMatchObject({ reason: 'steady' });
  run(held, BUDGET_MS, 120000);
  expect(held.retryAfterMs).toBe(15000);
});

test('one late frame does not move the tier', () => {
  for (const late of [600, 3000]) {
    const v = new ViewDistance({ start: 8 });
    for (let i = 0; i < 20; i++) v.record(BUDGET_MS);
    for (let i = 0; i < 15; i++) v.record(BUDGET_MS);
    v.record(late);
    for (let i = 0; i < 100; i++) v.record(BUDGET_MS);
    expect(v.tier).toBe(8);
    expect(v.changes).toEqual([]);
  }
});

test('a long gap does not count as time at budget', () => {
  const v = new ViewDistance({ start: 8 });
  for (let i = 0; i < 60; i++) v.record(BUDGET_MS);
  // 3 seconds away is one frame, about 50 ms of steady time, not 3 seconds.
  v.record(3000);
  expect(run(v, BUDGET_MS, 4000)).toEqual([]);
  expect(v.tier).toBe(8);
});

test('frame times that are not positive numbers are ignored', () => {
  const v = new ViewDistance({ start: 8 });
  for (const bad of [NaN, Infinity, -Infinity, 0, -5]) expect(v.record(bad)).toBeNull();
  expect(run(v, BUDGET_MS, 8000)[0]).toMatchObject({ from: 8, to: 9 });
  expect(run(v, BUDGET_MS, 20000)[0]).toMatchObject({ from: 9, to: 10 });
});

test('after a step down there is nothing to settle, after a step up it waits for the chunks', () => {
  const v = new ViewDistance({ start: 8 });
  expect(run(v, 19, 3000)[0]).toMatchObject({ to: 7 });
  // Slow again right away: the next 30 frames decide, without 20 ignored first.
  for (let i = 0; i < 29; i++) expect(v.record(19)).toBeNull();
  expect(v.record(19)).toMatchObject({ from: 7, to: 6 });

  const up = new ViewDistance({ start: 8 });
  expect(run(up, BUDGET_MS, 8000)[0]).toMatchObject({ to: 9 });
  // Chunks still loading: the slow frames they cause are not counted, however many there are.
  for (let i = 0; i < 300; i++) expect(up.record(80, 12)).toBeNull();
  expect(up.tier).toBe(9);
  // Loaded: 20 more frames to settle, then it counts again.
  for (let i = 0; i < 20; i++) expect(up.record(80, 0)).toBeNull();
  expect(run(up, 19, 3000)[0]).toMatchObject({ from: 9, to: 8 });
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
