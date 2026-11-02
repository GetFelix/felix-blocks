import { readFileSync } from 'node:fs';
import { FakeGateway, FakeScope } from 'felix-gateway-client/fake';
import { beforeAll, expect, test } from 'vitest';
import { keyOf } from './chunk-store';
import { cellIndex, EditableWorld, type ChunkPos } from './editable-world';
import { EditSync } from './edit-sync';
import { createGeneratedWorld, loadGenerator } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));
beforeAll(async () => {
  await loadGenerator(wasm);
  KEY = keyOf(CX, CY, CZ);
});

// Chunk 100, 5, 100 is above the terrain's lowest layers; any chunk works, the tests only read what they set.
const [CX, CY, CZ] = [100, 5, 100];
let KEY = '';
const at = (dx: number, dy: number, dz: number) => [CX * 16 + dx, CY * 16 + dy, CZ * 16 + dz] as const;

function player(scope: FakeScope, options: { onError?: (e: unknown) => void } = {}) {
  const world = new EditableWorld(createGeneratedWorld(11));
  const changed: ChunkPos[][] = [];
  const gateway = new FakeGateway(scope);
  const sync = new EditSync(world, gateway, { onChanged: (c) => changed.push(c), ...options });
  const block = (dx: number, dy: number, dz: number) => world.chunk(CX, CY, CZ)![cellIndex(dx, dy, dz)]!;
  return { world, sync, gateway, changed, block };
}

/** A block id different from what the generator put at the cell. */
const other = (world: EditableWorld, dx: number, dy: number, dz: number) =>
  world.generated.chunk(CX, CY, CZ)![cellIndex(dx, dy, dz)] === 9 ? 3 : 9;

test('an edit shows at once, and reaches Felix on the next flush', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const id = other(a.world, 1, 2, 3);
  expect(a.sync.edit(...at(1, 2, 3), id)).toBe(true);
  expect(a.block(1, 2, 3)).toBe(id);
  expect(a.changed).toEqual([[[CX, CY, CZ]]]);
  expect(scope.caches.get('chunks')?.has(KEY)).toBeFalsy();
  await a.sync.flush();
  expect(scope.caches.get('chunks')?.has(KEY)).toBe(true);
  expect(a.sync.dirty).toBe(false);
});

test('an edit that changes nothing is not written', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const same = a.world.generated.chunk(CX, CY, CZ)![cellIndex(1, 2, 3)]!;
  expect(a.sync.edit(...at(1, 2, 3), same)).toBe(false);
  await a.sync.flush();
  expect(scope.caches.get('chunks')?.size ?? 0).toBe(0);
});

test('an edit on the edge of a chunk redraws the neighbour too', () => {
  const a = player(new FakeScope());
  a.sync.edit(...at(0, 4, 15), other(a.world, 0, 4, 15));
  expect(a.changed[0]).toEqual(
    expect.arrayContaining([
      [CX, CY, CZ],
      [CX - 1, CY, CZ],
      [CX, CY, CZ + 1],
      [CX - 1, CY, CZ + 1],
    ]),
  );
});

test('edits made together are one write, and a new session reads them back', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const ids: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const id = other(a.world, i, 0, 0);
    ids.push([i, 0, 0, id]);
    a.sync.edit(...at(i, 0, 0), id);
  }
  const before = scope.versionOf('chunks', KEY);
  await a.sync.flush();
  expect(scope.versionOf('chunks', KEY)).not.toBe(before);

  const b = player(scope);
  b.sync.ingest(KEY, scope.readCache('chunks', KEY));
  for (const [x, y, z, id] of ids) expect(b.block(x, y, z)).toBe(id);
});

test('two players in one chunk keep both edits', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  const ida = other(a.world, 1, 0, 0);
  const idb = other(b.world, 2, 0, 0);
  a.sync.edit(...at(1, 0, 0), ida);
  b.sync.edit(...at(2, 0, 0), idb);
  await a.sync.flush();
  // Ben's write is refused at the version he read, then rebased onto Ana's chunk and written again.
  await b.sync.flush();
  expect(b.block(1, 0, 0)).toBe(ida);
  expect(b.block(2, 0, 0)).toBe(idb);
  a.sync.ingest(KEY, scope.readCache('chunks', KEY));
  expect(a.block(2, 0, 0)).toBe(idb);
  expect(a.block(1, 0, 0)).toBe(ida);
  expect(b.sync.dirty).toBe(false);
});

test('when both change the same cell the stored block wins', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  b.sync.edit(...at(3, 0, 0), 4);
  a.sync.edit(...at(3, 0, 0), 5);
  await a.sync.flush();
  await b.sync.flush();
  expect(b.block(3, 0, 0)).toBe(5);
  expect(b.sync.dirty).toBe(false);
});

test('a value from the watch is applied under the pending changes, and our own echo is ignored', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  const idb = other(b.world, 2, 0, 0);
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  b.sync.edit(...at(2, 0, 0), idb);
  b.sync.ingest(KEY, scope.readCache('chunks', KEY));
  expect(b.block(1, 0, 0)).toBe(4);
  expect(b.block(2, 0, 0)).toBe(idb);
  await b.sync.flush();
  const redraws = b.changed.length;
  b.sync.ingest(KEY, scope.readCache('chunks', KEY));
  expect(b.changed.length).toBe(redraws);
});

test('a failed write keeps the edit and is tried again later', async () => {
  const scope = new FakeScope();
  const errors: unknown[] = [];
  const a = player(scope, { onError: (e) => errors.push(e) });
  const put = a.gateway.cachePutIf.bind(a.gateway);
  let failing = true;
  a.gateway.cachePutIf = async (...args) => {
    if (failing) throw new Error('unavailable');
    return put(...args);
  };
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  expect(errors).toHaveLength(1);
  expect(a.sync.dirty).toBe(true);
  expect(a.block(1, 0, 0)).toBe(4);
  failing = false;
  await new Promise((r) => setTimeout(r, 1100));
  await a.sync.flush();
  expect(a.sync.dirty).toBe(false);
  expect(scope.caches.get('chunks')?.has(KEY)).toBe(true);
});

test('a value that cannot be read is skipped', () => {
  const errors: unknown[] = [];
  const a = player(new FakeScope(), { onError: (e) => errors.push(e) });
  a.sync.ingest(KEY, Uint8Array.of(9, 9, 9));
  expect(errors).toHaveLength(1);
});
