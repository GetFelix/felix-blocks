// A chunk's key and stored value. The rules are in core/ (Rust); these are typed handles on its WebAssembly build.
// `loadGenerator` (worldgen.ts) has to have finished.
import {
  applyChunk,
  chunkKey,
  encodeChunk,
  parseChunkKey,
  regionPrefix,
  valueGeneratorVersion,
} from './core/felix_blocks_core.js';

/** The cache key of a chunk. Throws for a chunk outside the world. */
export const keyOf = (cx: number, cy: number, cz: number): string => chunkKey(cx, cy, cz);

/** The chunk a key names as `[cx, cy, cz]`, or null if it is not a chunk key. */
export function chunkOf(key: string): [number, number, number] | null {
  const pos = parseChunkKey(key);
  return pos.length === 3 ? [pos[0]!, pos[1]!, pos[2]!] : null;
}

/** The prefix shared by the keys of region `rx`, `rz` (8 x 8 chunks). Throws for a region outside the world. */
export const prefixOf = (rx: number, rz: number): string => regionPrefix(rx, rz);

/** The value to store for a chunk now holding `current` where the generator made `generated`. The shorter encoding wins. */
export const encodeValue = (version: number, generated: Uint8Array, current: Uint8Array): Uint8Array =>
  encodeChunk(version, generated, current);

/**
 * The chunk a stored value makes over `generated`, which the generator of `version` made. Throws if the value is
 * malformed, or is a list of changes written on another generator version. Block ids the table does not have are
 * read as they are, so a newer client's blocks do not fail an older one.
 */
export const decodeValue = (value: Uint8Array, version: number, generated: Uint8Array): Uint8Array =>
  applyChunk(value, version, generated);

/** The generator version a stored value was edited on. Throws if the value is not a chunk value. */
export const valueVersion = (value: Uint8Array): number => valueGeneratorVersion(value);
