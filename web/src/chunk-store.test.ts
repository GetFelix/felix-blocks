import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { chunkOf, decodeValue, encodeValue, keyOf, prefixOf, valueVersion } from './chunk-store';
import { createGeneratedWorld, loadGenerator } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));

beforeAll(async () => {
  await loadGenerator(wasm);
});

test('keys put the region first and read back', () => {
  expect(keyOf(3, 5, 30)).toBe('R8000_8003-365');
  expect(prefixOf(0, 3)).toBe('R8000_8003-');
  expect(chunkOf('R801f_801f-77f')).toEqual([255, 15, 255]);
  expect(chunkOf('R801F_801f-77f')).toBeNull();
  expect(chunkOf('nonsense')).toBeNull();
  expect(() => keyOf(256, 0, 0)).toThrow();
  expect(() => prefixOf(0, 32)).toThrow();
});

test('an edited generated chunk is stored as its changes and reads back', () => {
  const world = createGeneratedWorld(11);
  const generated = world.chunk(100, 5, 100)!;
  const current = generated.slice();
  const other = (b: number) => (b === 9 ? 3 : 9);
  current[0] = other(generated[0]!);
  current[4000] = other(generated[4000]!);
  const value = encodeValue(1, generated, current);
  expect(value).toHaveLength(4 + 3 * 2);
  expect(valueVersion(value)).toBe(1);
  expect(decodeValue(value, 1, generated)).toEqual(current);
  expect(() => decodeValue(value, 2, generated)).toThrow(/generator/);
});

test('a chunk is refused if it is the wrong size or holds the not-loaded marker', () => {
  const chunk = new Uint8Array(4096);
  expect(() => encodeValue(1, chunk, new Uint8Array(10))).toThrow();
  expect(() => encodeValue(1, chunk, new Uint8Array(4096).fill(255))).toThrow();
  expect(() => decodeValue(new Uint8Array([9, 1]), 1, chunk)).toThrow(/format/);
  expect(() => valueVersion(new Uint8Array())).toThrow();
});
