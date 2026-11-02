// The meshing worker. It loads core/ once and answers each job with the chunk's meshes, moving the buffers back.
import { loadMesher, meshChunk, transferList, type ChunkMeshData, type ChunkNeighbourhood } from './meshing';

export interface MeshRequest {
  id: number;
  chunks: ChunkNeighbourhood;
}
export type MeshResponse = { id: number; data: ChunkMeshData; ms: number } | { id: number; error: string };

const ready = loadMesher();

self.onmessage = async (e: MessageEvent<MeshRequest>) => {
  const { id, chunks } = e.data;
  try {
    await ready;
    const start = performance.now();
    const data = meshChunk(chunks);
    const reply: MeshResponse = { id, data, ms: performance.now() - start };
    (self as unknown as Worker).postMessage(reply, transferList(data));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies MeshResponse);
  }
};
