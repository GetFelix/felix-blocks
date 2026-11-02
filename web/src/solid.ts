// Which blocks stop the player, and what is at a place in the world. Physics asks for blocks; where they come from
// (generated terrain, edits, chunks that have not arrived) is the source's business.
import type { BlockTable } from './core';

/** The marker for a cell whose chunk is not loaded. It is never a block, and the player cannot enter it. */
export const UNLOADED = 255;
export const CHUNK = 16;

/** Anything that can hand out a chunk's 4,096 blocks, laid out as `(y << 8) | (z << 4) | x`. */
export interface ChunkSource {
  /** The chunk at these chunk coordinates, or null if it is outside the world or not loaded. */
  chunk(cx: number, cy: number, cz: number): Uint8Array | null;
}

/** The block at a place, in whole-world block coordinates. */
export interface Blocks {
  block(x: number, y: number, z: number): number;
}

/** A 256-entry table: 1 for a block the player stands on and is stopped by. Air and water are not solid. */
export function solidTable(table: BlockTable): Uint8Array {
  const solid = new Uint8Array(256);
  for (const block of table.blocks) solid[block.id] = block.pass === 'water' ? 0 : 1;
  solid[UNLOADED] = 1;
  return solid;
}

/** The ids of water, which the player can swim in. */
export function waterIds(table: BlockTable): Uint8Array {
  const water = new Uint8Array(256);
  for (const block of table.blocks) water[block.id] = block.pass === 'water' ? 1 : 0;
  return water;
}

/**
 * Blocks by world coordinates over a chunk source. Beyond the sides of the world and below it is a wall, above it is
 * air, and a chunk the source does not have is UNLOADED, so the player waits at its edge instead of falling through.
 */
export function blocksOf(source: ChunkSource, size: readonly [number, number, number]): Blocks {
  const [wx, wy, wz] = size;
  return {
    block(x, y, z) {
      const [bx, by, bz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
      const [cx, cy, cz] = [bx >> 4, by >> 4, bz >> 4];
      if (cx < 0 || cz < 0 || cx >= wx || cz >= wz || cy < 0) return UNLOADED;
      if (cy >= wy) return 0;
      const chunk = source.chunk(cx, cy, cz);
      return chunk ? chunk[((by & 15) << 8) | ((bz & 15) << 4) | (bx & 15)]! : UNLOADED;
    },
  };
}
