// A world's generated terrain. The rules live in core/ (Rust); this holds the chunks the page has asked for so a
// chunk and its 26 neighbours do not regenerate 27 times.
import init, { generateChunk, generatorVersion, groundHeight } from './core/felix_blocks_core.js';
import type { ChunkNeighbourhood } from './meshing';

export const CHUNK = 16;
/** A world's size in chunks: x, y (up) and z. */
export const WORLD_CHUNKS = [256, 16, 256] as const;
/** Water fills every column below this height. */
export const SEA_LEVEL = 70;
/** Chunks from the bottom that can hold anything but air, in generator version 1. */
export const TERRAIN_LAYERS = 8;
/** Chunks kept after they are generated, nearest the last request first to go. About 4 KiB each. */
const KEEP = 4096;

export interface GeneratedWorld {
  readonly seed: number;
  readonly version: number;
  /** The chunk at these chunk coordinates, or null outside the world. */
  chunk(cx: number, cy: number, cz: number): Uint8Array | null;
  /** The chunk and its 26 neighbours, for the mesher. Chunks outside the world are missing. */
  neighbourhood(cx: number, cy: number, cz: number): ChunkNeighbourhood;
  /** Height of the highest ground block in a column, before caves and trees, or the sea if that is higher. */
  surface(x: number, z: number): number;
}

/** Loads the WebAssembly module (once). Pass the module's bytes outside a browser. */
export async function loadGenerator(wasm?: BufferSource): Promise<number> {
  await init(wasm ? { module_or_path: wasm } : undefined);
  return generatorVersion();
}

const inside = (cx: number, cy: number, cz: number) =>
  cx >= 0 && cy >= 0 && cz >= 0 && cx < WORLD_CHUNKS[0] && cy < WORLD_CHUNKS[1] && cz < WORLD_CHUNKS[2];

/** The terrain of one seed. `loadGenerator` has to have finished. */
export function createGeneratedWorld(seed: number, version = generatorVersion()): GeneratedWorld {
  const made = new Map<string, Uint8Array>();
  const read = (cx: number, cy: number, cz: number) => {
    if (!inside(cx, cy, cz)) return null;
    const key = `${cx},${cy},${cz}`;
    let chunk = made.get(key);
    if (chunk) {
      // Reinsert so the oldest entry is the one used longest ago.
      made.delete(key);
    } else {
      chunk = generateChunk(version, seed, cx, cy, cz);
      if (made.size >= KEEP) made.delete(made.keys().next().value!);
    }
    made.set(key, chunk);
    return chunk;
  };
  return {
    seed,
    version,
    chunk: read,
    neighbourhood(cx, cy, cz) {
      const out: (Uint8Array | null)[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(read(cx + dx, cy + dy, cz + dz));
      return out;
    },
    surface(x, z) {
      const clamp = (v: number, size: number) => Math.max(0, Math.min(size * CHUNK - 1, Math.floor(v)));
      return Math.max(groundHeight(version, seed, clamp(x, WORLD_CHUNKS[0]), clamp(z, WORLD_CHUNKS[2])), SEA_LEVEL);
    },
  };
}
