import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadBlockTable } from './core';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));

test('the block table comes through WebAssembly with ids in order and air left out', async () => {
  const table = await loadBlockTable(wasm);
  expect(table.blocks.map((b) => b.id)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  expect(table.blocks[0]).toMatchObject({ name: 'Grass', top: 'grass_top', side: 'dirt_grass', bottom: 'dirt' });
  expect(new Set(table.blocks.map((b) => b.pass))).toEqual(new Set(['opaque', 'cutout', 'glass', 'water']));
});

test('every face and plant tile is in the tile list, once', async () => {
  const table = await loadBlockTable(wasm);
  const used = table.blocks.flatMap((b) => [b.top, b.side, b.bottom]).concat(table.plants);
  expect(new Set(table.tiles)).toEqual(new Set(used));
  expect(new Set(table.tiles).size).toBe(table.tiles.length);
});
