import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import init, { Neighbourhood } from './core/felix_blocks_core.js';

const OPAQUE = 0;
const cell = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url)) });
});

/** A chunk with every neighbour loaded as air, so every outside face counts. */
function surrounded(chunk: Uint8Array): Neighbourhood {
  const n = new Neighbourhood();
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        n.setChunk(dx, dy, dz, dx || dy || dz ? new Uint8Array(4096) : chunk);
      }
  return n;
}

test('one block meshes to six quads with the arrays the page needs', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(5, 5, 5)] = 3;
  const mesh = surrounded(chunk).mesh();
  expect(mesh.quads(OPAQUE)).toBe(6);
  expect(mesh.positions(OPAQUE)).toHaveLength(6 * 4 * 3);
  expect(mesh.normals(OPAQUE)).toHaveLength(6 * 4 * 3);
  expect(mesh.uvs(OPAQUE)).toHaveLength(6 * 4 * 2);
  expect(mesh.tiles(OPAQUE)).toHaveLength(6 * 4);
  expect(mesh.ao(OPAQUE)).toHaveLength(6 * 4);
  expect(mesh.indices(OPAQUE)).toHaveLength(36);
  expect(mesh.quads(1) + mesh.quads(2) + mesh.quads(3)).toBe(0);
});

test('a bad chunk or offset or pass is an error, not a crash', () => {
  const n = new Neighbourhood();
  expect(() => n.setChunk(0, 0, 0, new Uint8Array(10))).toThrow();
  expect(() => n.setChunk(2, 0, 0, new Uint8Array(4096))).toThrow();
  expect(() => n.mesh().quads(4)).toThrow();
});

test('a dense chunk meshes in under 2 ms in WebAssembly', () => {
  // Mixed blocks with plenty of air, glass and water: close to the worst case for merging.
  const kinds = [0, 0, 1, 3, 3, 5, 7, 9];
  let s = 12345;
  const next = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16) % kinds.length;
  const chunk = Uint8Array.from({ length: 4096 }, () => kinds[next()]!);
  const n = surrounded(chunk);
  for (let i = 0; i < 20; i++) n.mesh();
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    n.mesh();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[50]!;
  console.log(`dense chunk: median ${median.toFixed(2)} ms, worst ${times[99]!.toFixed(2)} ms`);
  expect(median).toBeLessThan(2);
});
