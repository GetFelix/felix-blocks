// The world the player sees: generated terrain with the edited chunks laid over it. A chunk is copied the first time
// it is edited, because the generated one is shared with the generator's cache.
import type { ChunkNeighbourhood } from './meshing';
import type { ChunkSource } from './solid';
import type { GeneratedWorld } from './worldgen';

export type ChunkPos = readonly [number, number, number];

const keyOf = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;

/** The index of the cell at `x, y, z` (each 0 to 15) in a chunk's blocks. */
export const cellIndex = (x: number, y: number, z: number): number => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);

export class EditableWorld implements ChunkSource {
  private readonly edited = new Map<string, Uint8Array>();

  constructor(readonly generated: GeneratedWorld) {}

  /** The chunk as it is now, or null outside the world. */
  chunk(cx: number, cy: number, cz: number): Uint8Array | null {
    return this.edited.get(keyOf(cx, cy, cz)) ?? this.generated.chunk(cx, cy, cz);
  }

  /** The chunk and its 26 neighbours, for the mesher. Chunks outside the world are missing. */
  neighbourhood(cx: number, cy: number, cz: number): ChunkNeighbourhood {
    const out: (Uint8Array | null)[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(this.chunk(cx + dx, cy + dy, cz + dz));
    return out;
  }

  /**
   * Sets one block, given in world coordinates. Returns the chunks whose mesh changes: the one edited and, on the
   * edge of a chunk, the neighbours that draw its faces. Empty if the cell is outside the world or already holds `id`.
   */
  setBlock(x: number, y: number, z: number, id: number): ChunkPos[] {
    const [cx, cy, cz] = [x >> 4, y >> 4, z >> 4];
    const current = this.chunk(cx, cy, cz);
    if (!current || current[cellIndex(x, y, z)] === id) return [];
    this.write(cx, cy, cz)[cellIndex(x, y, z)] = id;
    return this.touched(cx, cy, cz, [x & 15, y & 15, z & 15]);
  }

  /** Replaces a whole chunk with `blocks`, which the caller no longer changes. Does nothing outside the world. */
  setChunk(cx: number, cy: number, cz: number, blocks: Uint8Array): void {
    if (this.generated.chunk(cx, cy, cz)) this.edited.set(keyOf(cx, cy, cz), blocks);
  }

  /** The chunks that draw something of the chunk at `cx, cy, cz`, which changed at `cell` (or anywhere, if omitted). */
  touched(cx: number, cy: number, cz: number, cell?: readonly [number, number, number]): ChunkPos[] {
    const out: ChunkPos[] = [[cx, cy, cz]];
    const reach = (c: number) => (cell ? (c === 0 ? [-1] : c === 15 ? [1] : []) : [-1, 1]);
    for (const dx of [0, ...reach(cell?.[0] ?? 0)])
      for (const dy of [0, ...reach(cell?.[1] ?? 0)])
        for (const dz of [0, ...reach(cell?.[2] ?? 0)]) {
          if ((dx || dy || dz) && this.generated.chunk(cx + dx, cy + dy, cz + dz))
            out.push([cx + dx, cy + dy, cz + dz]);
        }
    return out;
  }

  private write(cx: number, cy: number, cz: number): Uint8Array {
    const key = keyOf(cx, cy, cz);
    let blocks = this.edited.get(key);
    if (!blocks) {
      blocks = this.generated.chunk(cx, cy, cz)!.slice();
      this.edited.set(key, blocks);
    }
    return blocks;
  }
}
