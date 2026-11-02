import * as THREE from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { ChunkView } from './chunk-view';
import type { MeshResult } from './mesher';
import type { TerrainMaterials } from './terrain';
import type { ChunkMeshData, PassMesh } from './meshing';

const none = (): PassMesh => ({
  positions: new Float32Array(),
  normals: new Int8Array(),
  uvs: new Float32Array(),
  tiles: new Uint8Array(),
  ao: new Uint8Array(),
  indices: new Uint32Array(),
});
const empty = [none(), none(), none(), none()] as ChunkMeshData;
const materials = {} as TerrainMaterials;

interface Call {
  key: string;
  priority: number;
  resolve: (r: MeshResult | null) => void;
  reject: (e: Error) => void;
}

/** A mesher that answers when the test says so. */
function fakeMesher() {
  const calls: Call[] = [];
  const cancelled: string[] = [];
  const priorities = new Map<string, number>();
  return {
    calls,
    cancelled,
    priorities,
    queued: 0,
    busy: 0,
    request: (key: string, _chunks: unknown, priority = 0) =>
      new Promise<MeshResult | null>((resolve, reject) => calls.push({ key, priority, resolve, reject })),
    cancel: (key: string) => void cancelled.push(key),
    prioritize: (key: string, priority: number) => {
      priorities.set(key, priority);
      return true;
    },
  };
}

const at = (cx: number, cz: number) => new THREE.Vector3(cx * 16 + 8, 0, cz * 16 + 8);
const source = () => [] as never;

function view(height = 1) {
  const mesher = fakeMesher();
  const scene = new THREE.Scene();
  return { mesher, scene, view: new ChunkView(scene, mesher, materials, source, height) };
}

afterEach(() => vi.restoreAllMocks());

test('a request that fails is released, reported once, and not retried while in range', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { mesher, view: v } = view();
  v.update(at(0, 0), 0);
  expect(v.pending).toBe(1);
  mesher.calls[0]!.reject(new Error('boom'));
  await Promise.resolve();
  await Promise.resolve();
  expect(v.pending).toBe(0);
  expect(error).toHaveBeenCalledTimes(1);
  v.update(at(0, 0), 0);
  expect(mesher.calls).toHaveLength(1);
});

test('chunks that fall out of range are cancelled and no longer pending', () => {
  const { mesher, view: v } = view();
  v.update(at(0, 0), 1);
  expect(v.pending).toBe(5);
  v.update(at(10, 0), 1);
  expect(mesher.cancelled.sort()).toEqual(['-1,0,0', '0,0,-1', '0,0,0', '0,0,1', '1,0,0']);
  expect(v.pending).toBe(5);
});

test('the answer to a cancelled request is ignored, even after the chunk is asked for again', async () => {
  const { mesher, scene, view: v } = view();
  v.update(at(0, 0), 0);
  v.update(at(10, 0), 0);
  v.update(at(0, 0), 0);
  expect(mesher.calls).toHaveLength(3);
  mesher.calls[0]!.resolve({ data: empty, ms: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(v.loadedChunks).toBe(0);
  expect(v.pending).toBe(1);
  expect(scene.children).toHaveLength(0);
  mesher.calls[2]!.resolve({ data: empty, ms: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(v.loadedChunks).toBe(1);
});

test('waiting chunks are re-ranked by their distance from the new position', () => {
  const { mesher, view: v } = view();
  v.update(at(0, 0), 2);
  mesher.priorities.clear();
  v.update(at(1, 0), 2);
  // The chunk the player left is now one away; the one two ahead of the old position is one away from the new.
  expect(mesher.priorities.get('0,0,0')).toBe(1);
  expect(mesher.priorities.get('2,0,0')).toBe(1);
  expect(mesher.priorities.get('-2,0,0')).toBe(9);
  mesher.priorities.clear();
  v.update(at(1, 0), 2);
  expect(mesher.priorities.size).toBe(0);
});

test('a chunk that is shown and later dropped leaves the scene', async () => {
  const { mesher, scene, view: v } = view();
  v.update(at(0, 0), 0);
  mesher.calls[0]!.resolve({ data: empty, ms: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(scene.children).toHaveLength(1);
  v.update(at(5, 0), 0);
  expect(scene.children).toHaveLength(0);
});
