import { expect, test } from 'vitest';
import { blocksPlayer, lookDirection, raycast, targetTable } from './raycast';
import { UNLOADED, type Blocks } from './solid';

const table = targetTable([
  { id: 1, pass: 'opaque' },
  { id: 2, pass: 'water' },
]);

/** A world where the listed cells hold a block; everything else is air, and x < 0 is not loaded. */
const world = (cells: Record<string, number>): Blocks => ({
  block: (x, y, z) => (x < 0 ? UNLOADED : (cells[`${x},${y},${z}`] ?? 0)),
});

test('a ray finds the first block and the empty cell in front of it', () => {
  const hit = raycast(world({ '5,0,0': 1 }), [0.5, 0.5, 0.5], [1, 0, 0], table);
  expect(hit).toMatchObject({ x: 5, y: 0, z: 0, before: [4, 0, 0] });
  expect(hit!.distance).toBeCloseTo(4.5);
});

test('it works in every direction, and along a diagonal', () => {
  for (const [dir, cell, before] of [
    [
      [-1, 0, 0],
      [2, 2, 5],
      [3, 2, 5],
    ],
    [
      [0, 1, 0],
      [5, 4, 5],
      [5, 3, 5],
    ],
    [
      [0, -1, 0],
      [5, 0, 5],
      [5, 1, 5],
    ],
    [
      [0, 0, 1],
      [5, 2, 7],
      [5, 2, 6],
    ],
    [
      [0, 0, -1],
      [5, 2, 3],
      [5, 2, 4],
    ],
  ] as const) {
    const cells = { [cell.join(',')]: 1 };
    const hit = raycast(world(cells), [5.5, 2.5, 5.5], dir, table, 10);
    expect(hit, `${dir}`).toMatchObject({ x: cell[0], y: cell[1], z: cell[2] });
    expect(hit!.before).toEqual(before);
  }
  const d = 1 / Math.sqrt(3);
  const diagonal = raycast(world({ '8,8,8': 1 }), [5.5, 5.5, 5.5], [d, d, d], table);
  expect(diagonal).toMatchObject({ x: 8, y: 8, z: 8 });
});

test('a block out of reach, water and the not-loaded marker are not hit', () => {
  expect(raycast(world({ '9,0,0': 1 }), [0.5, 0.5, 0.5], [1, 0, 0], table, 6)).toBeNull();
  expect(raycast(world({ '3,0,0': 2 }), [0.5, 0.5, 0.5], [1, 0, 0], table)).toBeNull();
  expect(raycast(world({ '3,0,0': 1 }), [2.5, 0.5, 0.5], [-1, 0, 0], table)).toBeNull();
});

test('a ray that starts in a block hits it with nothing in front', () => {
  const hit = raycast(world({ '1,1,1': 1 }), [1.5, 1.5, 1.5], [0, 0, 1], table);
  expect(hit).toMatchObject({ x: 1, y: 1, z: 1, before: [1, 1, 1], distance: 0 });
});

test('the look direction matches the walk: yaw 0 faces -z, a left turn faces -x', () => {
  const [x0, y0, z0] = lookDirection(0, 0);
  expect([x0 + 0, y0 + 0, z0]).toEqual([0, 0, -1]);
  const [x1, , z1] = lookDirection(Math.PI / 2, 0);
  expect(x1).toBeCloseTo(-1);
  expect(z1).toBeCloseTo(0);
  const up = lookDirection(0.3, Math.PI / 2);
  expect(up[1]).toBeCloseTo(1);
});

test('a block cannot be placed where the player stands', () => {
  const player = { x: 5.5, y: 10, z: 5.5 };
  expect(blocksPlayer([5, 10, 5], player, 0.3, 1.8)).toBe(true);
  expect(blocksPlayer([5, 11, 5], player, 0.3, 1.8)).toBe(true);
  expect(blocksPlayer([5, 12, 5], player, 0.3, 1.8)).toBe(false);
  expect(blocksPlayer([5, 9, 5], player, 0.3, 1.8)).toBe(false);
  expect(blocksPlayer([6, 10, 5], player, 0.3, 1.8)).toBe(false);
});
