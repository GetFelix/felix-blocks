// The chunks around the player as meshes in a scene: asks the mesher for the ones that come into range, nearest
// first, and frees the ones that leave it.
import type * as THREE from 'three';
import type { Mesher } from './mesher';
import type { ChunkNeighbourhood } from './meshing';
import { chunkMeshes, type ChunkMeshes, type TerrainMaterials } from './terrain';

const CHUNK = 16;

/** Where the chunks come from: a chunk and its neighbours, or null if there is no such chunk. */
export type ChunkSource = (cx: number, cy: number, cz: number) => ChunkNeighbourhood | null;

export interface ViewStats {
  meshed: number;
  /** Time spent on the page turning a result into meshes, per result. */
  applyMs: number[];
  /** Time the mesher spent per chunk, wherever it ran. */
  meshMs: number[];
}

export class ChunkView {
  private readonly loaded = new Map<string, ChunkMeshes>();
  private readonly asked = new Set<string>();
  private keep: (cx: number, cz: number) => boolean = () => false;
  readonly stats: ViewStats = { meshed: 0, applyMs: [], meshMs: [] };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly mesher: Pick<Mesher, 'request' | 'cancel' | 'queued' | 'busy'>,
    private readonly materials: TerrainMaterials,
    private readonly source: ChunkSource,
    private readonly height: number,
  ) {}

  get loadedChunks(): number {
    return this.loaded.size;
  }

  get pending(): number {
    return this.asked.size;
  }

  /** Requests every chunk within `radius` chunks of `at` (horizontally) and drops those further than `radius + 1`. */
  update(at: THREE.Vector3, radius: number): void {
    const [px, pz] = [Math.floor(at.x / CHUNK), Math.floor(at.z / CHUNK)];
    this.keep = (cx, cz) => Math.max(Math.abs(cx - px), Math.abs(cz - pz)) <= radius + 1;
    for (let cz = pz - radius; cz <= pz + radius; cz++)
      for (let cx = px - radius; cx <= px + radius; cx++) {
        const d2 = (cx - px) ** 2 + (cz - pz) ** 2;
        if (d2 > radius * radius) continue;
        for (let cy = 0; cy < this.height; cy++) {
          const key = `${cx},${cy},${cz}`;
          if (this.loaded.has(key) || this.asked.has(key)) continue;
          const chunks = this.source(cx, cy, cz);
          if (!chunks) continue;
          this.asked.add(key);
          void this.mesher.request(key, chunks, d2).then((result) => {
            this.asked.delete(key);
            if (result && this.keep(cx, cz)) this.show(key, [cx, cy, cz], result.data, result.ms);
          });
        }
      }
    for (const [key, meshes] of this.loaded) {
      const [cx, , cz] = key.split(',').map(Number) as [number, number, number];
      if (!this.keep(cx, cz)) {
        this.scene.remove(meshes);
        meshes.dispose();
        this.loaded.delete(key);
      }
    }
  }

  private show(key: string, chunk: [number, number, number], data: Parameters<typeof chunkMeshes>[0], meshMs: number) {
    const start = performance.now();
    const meshes = chunkMeshes(data, this.materials, chunk);
    this.loaded.get(key)?.dispose();
    this.loaded.set(key, meshes);
    this.scene.add(meshes);
    this.stats.meshed++;
    this.stats.meshMs.push(meshMs);
    this.stats.applyMs.push(performance.now() - start);
  }
}
