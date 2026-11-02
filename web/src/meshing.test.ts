import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CENTRE, loadMesher, meshChunk, meshedHere, neighbourIndex, transferList } from './meshing';

const cell = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;

beforeAll(async () => {
  await loadMesher(readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url)));
});

function around(chunk: Uint8Array) {
  const chunks: (Uint8Array | null)[] = Array(27).fill(null);
  chunks[CENTRE] = chunk;
  return chunks;
}

test('the centre of the neighbourhood is index 13', () => {
  expect(neighbourIndex(0, 0, 0)).toBe(CENTRE);
  expect(neighbourIndex(-1, -1, -1)).toBe(0);
  expect(neighbourIndex(1, 1, 1)).toBe(26);
});

test('a block with no neighbours loaded meshes to its open faces only', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(0, 0, 0)] = 3;
  // The three faces that look into the chunk. The other three look at chunks that are not loaded.
  const [opaque] = meshChunk(around(chunk));
  expect(opaque.indices.length / 6).toBe(3);
});

test('a neighbour that is loaded and solid hides the faces against it', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(0, 0, 0)] = 3;
  const chunks = around(chunk);
  chunks[neighbourIndex(-1, 0, 0)] = new Uint8Array(4096).fill(3);
  expect(meshChunk(chunks)[0].indices.length / 6).toBe(3);
  chunks[neighbourIndex(-1, 0, 0)] = new Uint8Array(4096);
  expect(meshChunk(chunks)[0].indices.length / 6).toBe(4);
});

test('blocks go to the pass of their kind', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(2, 2, 2)] = 3;
  chunk[cell(6, 2, 2)] = 7;
  chunk[cell(10, 2, 2)] = 9;
  chunk[cell(14, 2, 2)] = 5;
  const passes = meshChunk(around(chunk));
  expect(passes.map((p) => p.indices.length > 0)).toEqual([true, true, true, true]);
});

test('a job without its own chunk is an error', () => {
  expect(() => meshChunk(Array(27).fill(null))).toThrow('the chunk itself');
});

test('transferList names every buffer once, so a result moves instead of being copied', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(5, 5, 5)] = 3;
  const buffers = transferList(meshChunk(around(chunk)));
  expect(buffers).toHaveLength(24);
  expect(new Set(buffers).size).toBe(24);
});

test('meshing on this thread is counted, so a page can show it did none', () => {
  const chunk = new Uint8Array(4096);
  chunk[cell(1, 1, 1)] = 3;
  const before = meshedHere.calls;
  meshChunk(around(chunk));
  meshChunk(around(chunk));
  expect(meshedHere.calls).toBe(before + 2);
  expect(meshedHere.ms).toBeGreaterThan(0);
});
