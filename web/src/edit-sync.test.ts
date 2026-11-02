import { readFileSync } from 'node:fs';
import { GatewayError } from 'felix-gateway-client';
import { FakeGateway, FakeScope } from 'felix-gateway-client/fake';
import { beforeAll, expect, test } from 'vitest';
import { decodeValue, keyOf } from './chunk-store';
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

function player(
  scope: FakeScope,
  options: { onError?: (e: unknown) => void; onBadValue?: (key: string, e: unknown) => void } = {},
) {
  const world = new EditableWorld(createGeneratedWorld(11));
  const changed: ChunkPos[][] = [];
  const gateway = new FakeGateway(scope);
  const clock = { now: 0 };
  const sync = new EditSync(world, gateway, { onChanged: (c) => changed.push(c), ...options }, () => clock.now);
  const block = (dx: number, dy: number, dz: number) => world.chunk(CX, CY, CZ)![cellIndex(dx, dy, dz)]!;
  // Every put's condition, in order.
  const conditions: unknown[] = [];
  const put = gateway.cachePutIf.bind(gateway);
  gateway.cachePutIf = (cache, key, payload, condition) => {
    conditions.push(condition);
    return put(cache, key, payload, condition);
  };
  return { world, sync, gateway, changed, block, clock, conditions };
}

/** The block Felix holds at a cell of the test chunk. */
function stored(scope: FakeScope, world: EditableWorld, dx: number, dy: number, dz: number): number {
  const generated = world.generated;
  const value = scope.readCache('chunks', KEY);
  const blocks = value
    ? decodeValue(value, generated.version, generated.chunk(CX, CY, CZ)!)
    : generated.chunk(CX, CY, CZ)!;
  return blocks[cellIndex(dx, dy, dz)]!;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
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
  a.sync.changed(KEY);
  await a.sync.flush();
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

test('a value loaded on join is applied under the pending changes, and our own echo is ignored', async () => {
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
  const puts = b.conditions.length;
  b.sync.changed(KEY);
  await b.sync.flush();
  expect(b.changed.length).toBe(redraws);
  expect(b.conditions.length).toBe(puts);
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
  await a.sync.flush();
  expect(a.sync.dirty).toBe(true);
  a.clock.now += 1000;
  await a.sync.flush();
  expect(a.sync.dirty).toBe(false);
  expect(scope.caches.get('chunks')?.has(KEY)).toBe(true);
});

test('a write the gateway refuses for its rate waits for the bucket and reports nothing', async () => {
  const scope = new FakeScope();
  const errors: unknown[] = [];
  const a = player(scope, { onError: (e) => errors.push(e) });
  const put = a.gateway.cachePutIf.bind(a.gateway);
  let refusing = true;
  a.gateway.cachePutIf = async (...args) => {
    if (refusing) throw new GatewayError('rate_limited', 'this session is writing faster than the gateway allows', 300);
    return put(...args);
  };
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  refusing = false;
  // Still held: the gateway asked for 300 ms.
  a.clock.now += 100;
  await a.sync.flush();
  expect(a.sync.dirty).toBe(true);
  a.clock.now += 200;
  await a.sync.flush();
  expect(a.sync.dirty).toBe(false);
  expect(errors).toHaveLength(0);
  expect(stored(scope, a.world, 1, 0, 0)).toBe(4);
});

test('a value that cannot be read is skipped', () => {
  const errors: unknown[] = [];
  const a = player(new FakeScope(), { onError: (e) => errors.push(e) });
  a.sync.ingest(KEY, Uint8Array.of(9, 9, 9));
  expect(errors).toHaveLength(1);
});

test('a bad value nobody has edited goes to onBadValue, not onError', () => {
  const errors: unknown[] = [];
  const bad: string[] = [];
  const a = player(new FakeScope(), { onError: (e) => errors.push(e), onBadValue: (key) => bad.push(key) });
  a.sync.ingest(KEY, Uint8Array.of(9, 9, 9));
  expect(bad).toEqual([KEY]);
  expect(errors).toHaveLength(0);
});

test('a bad value in a chunk with unsaved edits is a failed save', async () => {
  const scope = new FakeScope();
  scope.writeCache('chunks', KEY, Uint8Array.of(9, 9, 9));
  const errors: unknown[] = [];
  const bad: string[] = [];
  const a = player(scope, { onError: (e) => errors.push(e), onBadValue: (key) => bad.push(key) });
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  expect(errors).toHaveLength(1);
  expect(bad).toHaveLength(0);
  expect(a.sync.dirty).toBe(true);
});

test('a watch change during our put does not undo the write that put made', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  const ida = other(a.world, 1, 0, 0);
  const idb = other(b.world, 2, 0, 0);
  const gate = deferred();
  const put = a.gateway.cachePutIf;
  a.gateway.cachePutIf = async (...args) => {
    await gate.promise;
    return put(...args);
  };
  a.sync.edit(...at(1, 0, 0), ida);
  const flushing = a.sync.flush();
  b.sync.edit(...at(2, 0, 0), idb);
  await b.sync.flush();
  // The watch reports Ben's write while Ana's put is held; it lands after his, is refused and rebased.
  a.sync.changed(KEY);
  gate.resolve();
  await flushing;
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(ida);
  expect(a.block(2, 0, 0)).toBe(idb);
  expect(stored(scope, a.world, 1, 0, 0)).toBe(ida);
  expect(a.sync.dirty).toBe(false);
});

test('a late echo of an earlier write does not undo a newer edit', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  a.sync.edit(...at(1, 0, 0), 5);
  await a.sync.flush();
  a.sync.edit(...at(1, 0, 0), 6);
  // The watch's report of the first write arrives now.
  a.sync.changed(KEY);
  expect(a.block(1, 0, 0)).toBe(6);
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(6);
  expect(stored(scope, a.world, 1, 0, 0)).toBe(6);
});

test('a write by another player is applied even when its bytes equal an earlier write of ours', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  const id = other(a.world, 1, 0, 0);
  a.sync.edit(...at(1, 0, 0), id);
  await a.sync.flush();
  const ours = scope.readCache('chunks', KEY)!;
  b.sync.changed(KEY);
  await b.sync.flush();
  b.sync.edit(...at(1, 0, 0), 0);
  await b.sync.flush();
  a.sync.changed(KEY);
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(0);
  b.sync.edit(...at(1, 0, 0), id);
  await b.sync.flush();
  expect(scope.readCache('chunks', KEY)).toEqual(ours);
  a.sync.changed(KEY);
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(id);
});

test('a stored value that cannot be read sends no put', async () => {
  const scope = new FakeScope();
  const errors: unknown[] = [];
  const a = player(scope, { onError: (e) => errors.push(e) });
  scope.writeCache('chunks', KEY, Uint8Array.of(9, 9, 9));
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  expect(errors).toHaveLength(1);
  expect(a.conditions).toEqual([]);
  expect(a.sync.dirty).toBe(true);
});

test('an edit made during a put that applied without an answer is kept', async () => {
  const scope = new FakeScope();
  const errors: unknown[] = [];
  const a = player(scope, { onError: (e) => errors.push(e) });
  const put = a.gateway.cachePutIf;
  let once = true;
  a.gateway.cachePutIf = async (...args) => {
    const result = await put(...args);
    if (!once) return result;
    once = false;
    a.sync.edit(...at(1, 0, 0), 5);
    throw new Error('connection lost');
  };
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  expect(errors).toHaveLength(1);
  expect(stored(scope, a.world, 1, 0, 0)).toBe(4);
  a.clock.now += 1000;
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(5);
  expect(stored(scope, a.world, 1, 0, 0)).toBe(5);
  expect(a.sync.dirty).toBe(false);
});

test('a write after the key is deleted is conditional on no key', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const generated = a.world.generated.chunk(CX, CY, CZ)![cellIndex(1, 0, 0)];
  a.sync.edit(...at(1, 0, 0), other(a.world, 1, 0, 0));
  await a.sync.flush();
  scope.writeCache('chunks', KEY, null);
  a.sync.changed(KEY);
  a.sync.edit(...at(2, 0, 0), other(a.world, 2, 0, 0));
  await a.sync.flush();
  expect(a.conditions).toHaveLength(2);
  expect(a.conditions[1]).toBe('absent');
  expect(a.block(1, 0, 0)).toBe(generated);
  expect(a.sync.dirty).toBe(false);
});

test('a change from the watch shows without any edit of ours', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  const b = player(scope);
  const idb = other(b.world, 2, 0, 0);
  b.sync.edit(...at(2, 0, 0), idb);
  await b.sync.flush();
  a.sync.changed(KEY);
  await a.sync.flush();
  expect(a.block(2, 0, 0)).toBe(idb);
  expect(a.conditions).toEqual([]);
});

test('a key outside the world is ignored', () => {
  const a = player(new FakeScope());
  a.sync.changed('not a chunk');
  a.sync.ingest('not a chunk', null);
  expect(a.sync.dirty).toBe(false);
});

test('a join value for a chunk the client already read does not replace it', async () => {
  const scope = new FakeScope();
  const a = player(scope);
  a.sync.edit(...at(1, 0, 0), 4);
  await a.sync.flush();
  const first = scope.readCache('chunks', KEY);
  a.sync.edit(...at(1, 0, 0), 5);
  await a.sync.flush();
  a.sync.ingest(KEY, first);
  expect(a.block(1, 0, 0)).toBe(5);
  await a.sync.flush();
  expect(a.block(1, 0, 0)).toBe(5);
});
