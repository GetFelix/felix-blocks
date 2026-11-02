import { expect, test } from 'vitest';
import { CHUNK, createFixtureWorld } from './fixture-world';

const ids = { Stone: 3, Dirt: 2, Grass: 1, Sand: 4, Water: 5, 'Oak log': 6, Leaves: 7, 'Oak planks': 8, Glass: 9 };

test('chunks are 4096 bytes and the world ends at its edge', () => {
  const world = createFixtureWorld(ids, [2, 2, 2]);
  expect(world.chunk(0, 0, 0)).toHaveLength(CHUNK ** 3);
  expect(world.chunk(2, 0, 0)).toBeNull();
  expect(world.chunk(0, -1, 0)).toBeNull();
});

test('a neighbourhood has the chunk in the middle and nothing outside the world', () => {
  const world = createFixtureWorld(ids, [2, 2, 2]);
  const n = world.neighbourhood(0, 0, 0);
  expect(n).toHaveLength(27);
  expect(n[13]).toEqual(world.chunk(0, 0, 0));
  expect(n.filter(Boolean)).toHaveLength(8);
});

test('the same world comes out every time', () => {
  const a = createFixtureWorld(ids);
  const b = createFixtureWorld(ids);
  expect(a.chunk(3, 1, 4)).toEqual(b.chunk(3, 1, 4));
});

test('the world has ground, water, trees and a house with glass', () => {
  const world = createFixtureWorld(ids);
  const seen = new Set<number>();
  for (let cz = 0; cz < 8; cz++)
    for (let cx = 0; cx < 8; cx++) for (let cy = 0; cy < 3; cy++) world.chunk(cx, cy, cz)!.forEach((b) => seen.add(b));
  for (const name of ['Stone', 'Dirt', 'Grass', 'Sand', 'Water', 'Oak log', 'Leaves', 'Oak planks', 'Glass'] as const) {
    expect(seen.has(ids[name]), name).toBe(true);
  }
});
