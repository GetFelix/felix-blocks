// A world's generated terrain. The rules live in core/ (Rust); this holds the chunks the page has asked for so a
// chunk and its 26 neighbours do not regenerate 27 times.
import init, {
  generateChunk,
  generatorVersion,
  groundHeight,
  seaLevel,
  terrainLayers,
  worldChunks,
} from './core/felix_blocks_core.js';
import type { ChunkNeighbourhood } from './meshing';

export const CHUNK = 16;
// The world's rules come from core, so there is one copy. `seaLevel()`: water fills a column up to and including
// that block. `worldChunks()`: the size in chunks, x, y (up), z. `terrainLayers()`: layers from the bottom that can
// hold anything but air.
export { seaLevel, terrainLayers, worldChunks };
/**
 * Chunks kept after they are generated; the one used longest ago goes first. About 4 KiB each. A view at the largest
 * tier (12) spans 25 x 25 columns and the mesher reads a ring more, so 27 x 27 columns of 9 layers (8 and the air
 * above) is 6,561 chunks; this leaves room for the walk between requests.
 */
const KEEP = 8192;
const MAX_SEED = 0xffffffff;
const MAX_VERSION = 255;

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

/** The terrain of one seed, a whole number from 0 to 2^32 - 1. `loadGenerator` has to have finished. */
export function createGeneratedWorld(seed: number, version = generatorVersion()): GeneratedWorld {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new RangeError(`seed ${seed} is not a u32`);
  if (!Number.isInteger(version) || version < 0 || version > MAX_VERSION)
    throw new RangeError(`version ${version} is not a u8`);
  const [wx, wy, wz] = Array.from(worldChunks()) as [number, number, number];
  const sea = seaLevel();
  const inside = (cx: number, cy: number, cz: number) => cx >= 0 && cy >= 0 && cz >= 0 && cx < wx && cy < wy && cz < wz;
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
      return Math.max(groundHeight(version, seed, clamp(x, wx), clamp(z, wz)), sea);
    },
  };
}
