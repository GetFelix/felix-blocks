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
  /** Requested chunks that have no result yet. The object identifies the request, so a late answer to a cancelled one is ignored. */
  private readonly asked = new Map<string, { cx: number; cz: number }>();
  /** Chunks whose meshing failed. They are not asked for again until they leave range, or a broken mesher would be hit every frame. */
  private readonly failed = new Set<string>();
  private keep: (cx: number, cz: number) => boolean = () => false;
  private at: [number, number] | null = null;
  readonly stats: ViewStats = { meshed: 0, applyMs: [], meshMs: [] };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly mesher: Pick<Mesher, 'request' | 'cancel' | 'prioritize' | 'queued' | 'busy'>,
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

  /** Whether the chunk at these coordinates is drawn. */
  has(cx: number, cy: number, cz: number): boolean {
    return this.loaded.has(`${cx},${cy},${cz}`);
  }

  /**
   * Requests every chunk within `radius` chunks of `at` (horizontally) and drops those further than `radius + 1`.
   * Requests that fall out of range are cancelled, and the ones still waiting are re-ranked by the new distance.
   */
  update(at: THREE.Vector3, radius: number): void {
    const [px, pz] = [Math.floor(at.x / CHUNK), Math.floor(at.z / CHUNK)];
    const moved = this.at === null || this.at[0] !== px || this.at[1] !== pz;
    this.at = [px, pz];
    this.keep = (cx, cz) => Math.max(Math.abs(cx - px), Math.abs(cz - pz)) <= radius + 1;
    if (moved) {
      for (const key of this.failed) {
        const [cx, , cz] = key.split(',').map(Number) as [number, number, number];
        if (!this.keep(cx, cz)) this.failed.delete(key);
      }
      for (const [key, chunk] of this.asked) {
        if (!this.keep(chunk.cx, chunk.cz)) {
          this.asked.delete(key);
          this.mesher.cancel(key);
        } else this.mesher.prioritize(key, (chunk.cx - px) ** 2 + (chunk.cz - pz) ** 2);
      }
    }
    for (let cz = pz - radius; cz <= pz + radius; cz++)
      for (let cx = px - radius; cx <= px + radius; cx++) {
        const d2 = (cx - px) ** 2 + (cz - pz) ** 2;
        if (d2 > radius * radius) continue;
        for (let cy = 0; cy < this.height; cy++) {
          const key = `${cx},${cy},${cz}`;
          if (this.loaded.has(key) || this.asked.has(key) || this.failed.has(key)) continue;
          this.ask(cx, cy, cz, d2);
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

  /**
   * Meshes the chunks again after their blocks changed. The old mesh stays up until the new one is ready. Chunks that
   * are not drawn or asked for are left alone; they are meshed from the new blocks when they come into range.
   */
  invalidate(chunks: readonly (readonly [number, number, number])[]): void {
    for (const [cx, cy, cz] of chunks) {
      const key = `${cx},${cy},${cz}`;
      if (!this.loaded.has(key) && !this.asked.has(key)) continue;
      this.failed.delete(key);
      const [px, pz] = this.at ?? [cx, cz];
      this.ask(cx, cy, cz, (cx - px) ** 2 + (cz - pz) ** 2);
    }
  }

  private ask(cx: number, cy: number, cz: number, d2: number): void {
    const key = `${cx},${cy},${cz}`;
    const chunks = this.source(cx, cy, cz);
    if (!chunks) return;
    const request = { cx, cz };
    this.asked.set(key, request);
    this.mesher.request(key, chunks, d2).then(
      (result) => {
        if (this.asked.get(key) !== request) return;
        this.asked.delete(key);
        if (result && this.keep(cx, cz)) this.show(key, [cx, cy, cz], result.data, result.ms);
      },
      (error) => {
        if (this.asked.get(key) !== request) return;
        this.asked.delete(key);
        this.failed.add(key);
        console.error(`meshing chunk ${key} failed`, error);
      },
    );
  }

  private show(key: string, chunk: [number, number, number], data: Parameters<typeof chunkMeshes>[0], meshMs: number) {
    const start = performance.now();
    const meshes = chunkMeshes(data, this.materials, chunk);
    const replaced = this.loaded.get(key);
    if (replaced) {
      this.scene.remove(replaced);
      replaced.dispose();
    }
    this.loaded.set(key, meshes);
    this.scene.add(meshes);
    this.stats.meshed++;
    this.stats.meshMs.push(meshMs);
    this.stats.applyMs.push(performance.now() - start);
  }
}
