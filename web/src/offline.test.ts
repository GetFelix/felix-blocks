import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { cellIndex, EditableWorld } from './editable-world';
import { EditSync } from './edit-sync';
import { memoryStore, openOfflineWorld } from './offline';
import { INFO_CACHE, infoKey, newWorldInfo, readWorldInfo } from './world-info';
import { createGeneratedWorld, loadGenerator } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));
beforeAll(async () => {
  await loadGenerator(wasm);
});

/** A page's worth of the game over an offline world: the world it generates and the sync that saves its edits. */
async function visit(store: ReturnType<typeof memoryStore>, seed: number) {
  const offline = await openOfflineWorld(store, seed);
  const start = readWorldInfo((await offline.client.cacheGet(INFO_CACHE, infoKey()))!);
  const world = new EditableWorld(createGeneratedWorld(start.seed, start.version));
  const sync = new EditSync(world, offline.client);
  offline.client.onCacheEntries = (cache, entries) => {
    if (cache === 'chunks') for (const e of entries) sync.ingest(e.key, e.payload);
  };
  offline.client.cacheWatch('chunks');
  await new Promise((r) => setTimeout(r, 0));
  const save = async () => {
    for (let i = 0; i < 20 && sync.dirty; i++) await sync.flush();
    await offline.kept();
  };
  return { start, world, sync, save };
}

const block = (world: EditableWorld, x: number, y: number, z: number) =>
  world.chunk(x >> 4, y >> 4, z >> 4)![cellIndex(x, y, z)]!;

test('a new world gets the info blocks-tool would write, and keeps it', async () => {
  const store = memoryStore();
  const first = await visit(store, 11);
  expect(first.start.seed).toBe(11);
  expect(await store.load()).toEqual([{ cache: INFO_CACHE, key: infoKey(), value: newWorldInfo(11) }]);
  // The seed asked for is ignored once the world exists.
  expect((await visit(store, 3)).start.seed).toBe(11);
});

test('an edit survives closing the world and opening it again', async () => {
  const store = memoryStore();
  const first = await visit(store, 11);
  const [x, y, z] = [100, 70, 100];
  const was = block(first.world, x, y, z);
  const id = was === 5 ? 6 : 5;
  expect(first.sync.edit(x, y, z, id)).toBe(true);
  await first.save();
  const second = await visit(store, 11);
  expect(block(second.world, x, y, z)).toBe(id);
  // Only the edited chunk is stored besides the info.
  expect((await store.load()).map((e) => e.cache).sort()).toEqual(['chunks', INFO_CACHE]);
});

test('a store that cannot keep an entry is reported', async () => {
  const store = memoryStore();
  store.save = async () => {
    throw new Error('quota exceeded');
  };
  const errors: unknown[] = [];
  const offline = await openOfflineWorld(store, 11, (e) => errors.push(e));
  await offline.kept();
  expect(errors).toHaveLength(1);
});
