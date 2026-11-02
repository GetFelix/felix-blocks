// One meshing job: a chunk and its neighbours in, four draw passes of flat arrays out. It runs in the worker
// (mesher.worker.ts) and, for tests and check pages, on the page itself.
import init, { Neighbourhood } from './core/felix_blocks_core.js';

/** The chunks a job needs: the chunk and its 26 neighbours, indexed `(dy + 1) * 9 + (dz + 1) * 3 + (dx + 1)`. */
export type ChunkNeighbourhood = readonly (Uint8Array | null | undefined)[];
export const CENTRE = 13;

/** The arrays of one draw pass, ready to become vertex buffers. */
export interface PassMesh {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  tiles: Uint8Array;
  ao: Uint8Array;
  indices: Uint32Array;
}

/** Indexed by pass: 0 opaque, 1 cutout, 2 glass, 3 water. */
export type ChunkMeshData = [PassMesh, PassMesh, PassMesh, PassMesh];
export const PASS_NAMES = ['opaque', 'cutout', 'glass', 'water'] as const;

export const neighbourIndex = (dx: number, dy: number, dz: number) => (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);

/** Loads the WebAssembly module (once). Pass the module's bytes outside a browser. */
export async function loadMesher(wasm?: BufferSource): Promise<void> {
  await init(wasm ? { module_or_path: wasm } : undefined);
}

/** Meshes the centre chunk. Neighbours that are missing show as not loaded, so no wall is drawn against them. */
export function meshChunk(chunks: ChunkNeighbourhood): ChunkMeshData {
  const centre = chunks[CENTRE];
  if (!centre) throw new Error('a meshing job needs the chunk itself');
  const n = new Neighbourhood();
  try {
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const chunk = chunks[neighbourIndex(dx, dy, dz)];
          if (chunk) n.setChunk(dx, dy, dz, chunk);
        }
    const mesh = n.mesh();
    try {
      const pass = (p: number): PassMesh => ({
        positions: mesh.positions(p),
        normals: mesh.normals(p),
        uvs: mesh.uvs(p),
        tiles: mesh.tiles(p),
        ao: mesh.ao(p),
        indices: mesh.indices(p),
      });
      return [pass(0), pass(1), pass(2), pass(3)];
    } finally {
      mesh.free();
    }
  } finally {
    n.free();
  }
}

/** The buffers of a result, to hand to `postMessage` so they move instead of being copied. */
export function transferList(data: ChunkMeshData): ArrayBuffer[] {
  return data.flatMap((p) =>
    [p.positions, p.normals, p.uvs, p.tiles, p.ao, p.indices].map((a) => a.buffer as ArrayBuffer),
  );
}
