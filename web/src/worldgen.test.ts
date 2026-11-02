import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CHUNK, createGeneratedWorld, loadGenerator, SEA_LEVEL, TERRAIN_LAYERS } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));
const golden = readFileSync(new URL('../../core/testdata/worldgen.golden', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(' ') as [string, string, string, string, string]);

const fnv1a64 = (bytes: Uint8Array) => {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
};

test('the WebAssembly build makes the same bytes as the native one', async () => {
  const version = await loadGenerator(wasm);
  expect(version).toBe(1);
  expect(golden.length).toBeGreaterThan(200);
  // The golden file is checked against the native build by `cargo test`; matching it here means the two agree.
  const worlds = new Map<number, ReturnType<typeof createGeneratedWorld>>();
  for (const [seed, cx, cy, cz, hash] of golden) {
    const world = worlds.get(Number(seed)) ?? createGeneratedWorld(Number(seed));
    worlds.set(Number(seed), world);
    const chunk = world.chunk(Number(cx), Number(cy), Number(cz))!;
    expect(chunk).toHaveLength(CHUNK ** 3);
    expect(fnv1a64(chunk), `seed ${seed} chunk ${cx} ${cy} ${cz}`).toBe(hash);
  }
});

test('chunks outside the world are missing and the neighbourhood has the chunk in the middle', async () => {
  await loadGenerator(wasm);
  const world = createGeneratedWorld(3);
  expect(world.chunk(-1, 0, 0)).toBeNull();
  expect(world.chunk(0, 16, 0)).toBeNull();
  const n = world.neighbourhood(0, 0, 0);
  expect(n).toHaveLength(27);
  expect(n[13]).toEqual(world.chunk(0, 0, 0));
  expect(n.filter(Boolean)).toHaveLength(8);
});

test('nothing above the terrain layers is anything but air', async () => {
  await loadGenerator(wasm);
  for (const seed of [1, 99, 0xdeadbeef]) {
    const world = createGeneratedWorld(seed);
    for (let cx = 0; cx < 256; cx += 51) expect(world.chunk(cx, TERRAIN_LAYERS, cx)!.every((b) => b === 0)).toBe(true);
  }
});

test('the surface is never below the sea', async () => {
  await loadGenerator(wasm);
  const world = createGeneratedWorld(5);
  for (const [x, z] of [
    [-10, -10],
    [0, 0],
    [2000.5, 3000.2],
    [99999, 99999],
  ] as const)
    expect(world.surface(x, z)).toBeGreaterThanOrEqual(SEA_LEVEL);
});

test('an unknown generator version throws', async () => {
  await loadGenerator(wasm);
  expect(() => createGeneratedWorld(1, 9).chunk(0, 0, 0)).toThrow();
});
