import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { WorldInfo } from './core/felix_blocks_core.js';
import { cellIndex } from './editable-world';
import { infoKey, newWorldInfo, newWorldStart, readWorldInfo } from './world-info';
import { createGeneratedWorld, loadGenerator } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));

beforeAll(async () => {
  await loadGenerator(wasm);
});

test('a stored info value gives the seed, the generator and a spawn point with room to stand', () => {
  const start = readWorldInfo(WorldInfo.create(7).encode());
  expect(start).toEqual(newWorldStart(7));
  expect(start.seed).toBe(7);
  expect(start.version).toBe(1);
  const world = createGeneratedWorld(start.seed, start.version);
  const [x, y, z] = start.spawn;
  const block = (dy: number) => world.chunk(x >> 4, (y + dy) >> 4, z >> 4)![cellIndex(x, y + dy, z)];
  expect(block(-1)).not.toBe(0);
  expect(block(0)).toBe(0);
  expect(block(1)).toBe(0);
});

test('different seeds start in different places', () => {
  expect(newWorldStart(7).spawn).not.toEqual(newWorldStart(8).spawn);
});

test('the info lives under the key core names', () => {
  expect(infoKey()).toBe('info');
});

test('a value that is not world info is refused with a reason', () => {
  expect(() => readWorldInfo(new Uint8Array(5))).toThrow(/24 bytes/);
  const bad = WorldInfo.create(7).encode();
  bad[0] = 9;
  expect(() => readWorldInfo(bad)).toThrow(/format 9/);
});

test('a world of another size or from an unknown generator is refused', () => {
  const size = WorldInfo.create(7).encode();
  size[6] = 1; // x size
  size[7] = 0;
  expect(() => readWorldInfo(size)).toThrow(/chunks; this build makes/);
  const version = WorldInfo.create(7).encode();
  version[1] = 200;
  expect(() => readWorldInfo(version)).toThrow(/generator 200/);
});

test('a seed that is not a u32 is refused', () => {
  for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => newWorldStart(seed)).toThrow(/not a u32/);
  expect(() => newWorldInfo(2 ** 32)).toThrow(/not a u32/);
  expect(newWorldInfo(2 ** 32 - 1)).toHaveLength(24);
});
