import { expect, test } from 'vitest';
import { overlayLines } from './debug-overlay';

test('the panel shows the tier, the frame rate and the last tier changes with their reasons', () => {
  const change = (from: number, to: number, reason: 'slow' | 'steady', meanMs: number, at = 0) => ({
    at,
    from,
    to,
    reason,
    meanMs,
  });
  const lines = overlayLines({
    tier: 7,
    fps: 58.4,
    loaded: 210,
    meshing: 3,
    changes: [change(8, 7, 'slow', 21.04)],
  });
  expect(lines).toEqual(['view 7 chunks', '58 fps', '210 loaded, 3 meshing', '8 to 7: slow, 21.0 ms']);
});

test('only the last four changes are listed', () => {
  const changes = Array.from({ length: 6 }, (_, i) => ({
    at: i,
    from: i,
    to: i + 1,
    reason: 'steady' as const,
    meanMs: 16,
  }));
  const lines = overlayLines({ tier: 7, fps: 60, loaded: 1, meshing: 0, changes });
  expect(lines).toHaveLength(3 + 4);
  expect(lines[3]).toContain('2 to 3');
});

test('a frame rate that is not a number is not printed as one', () => {
  for (const fps of [Infinity, NaN, 0])
    expect(overlayLines({ tier: 8, fps, loaded: 0, meshing: 0, changes: [] })[1]).toBe('-- fps');
});
