import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { cellIndex, EditableWorld } from './editable-world';
import { createGeneratedWorld, loadGenerator } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));
beforeAll(async () => {
  await loadGenerator(wasm);
});

test('an edit copies the chunk and leaves the generated one alone', () => {
  const generated = createGeneratedWorld(11);
  const world = new EditableWorld(generated);
  const original = generated.chunk(100, 5, 100)!;
  const before = original[cellIndex(1, 1, 1)]!;
  const id = before === 9 ? 3 : 9;
  expect(world.setBlock(100 * 16 + 1, 5 * 16 + 1, 100 * 16 + 1, id)).toEqual([[100, 5, 100]]);
  expect(world.chunk(100, 5, 100)![cellIndex(1, 1, 1)]).toBe(id);
  expect(generated.chunk(100, 5, 100)![cellIndex(1, 1, 1)]).toBe(before);
  expect(world.setBlock(100 * 16 + 1, 5 * 16 + 1, 100 * 16 + 1, id)).toEqual([]);
});

test('the neighbourhood holds the edit, and cells outside the world change nothing', () => {
  const world = new EditableWorld(createGeneratedWorld(11));
  world.setBlock(0, 0, 0, 7);
  const near = world.neighbourhood(1, 0, 0);
  expect(near[13 - 1]![cellIndex(0, 0, 0)]).toBe(7);
  expect(world.setBlock(-1, 0, 0, 7)).toEqual([]);
  expect(world.setBlock(0, -1, 0, 7)).toEqual([]);
});
