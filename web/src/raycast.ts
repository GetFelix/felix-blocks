// Which block the player is looking at, found by stepping through the grid cell by cell along the view ray.
import { UNLOADED, type Blocks } from './solid';

/** The block a ray hit, and the empty cell in front of it. */
export interface Hit {
  x: number;
  y: number;
  z: number;
  /** The cell the ray was in just before it entered the block. It is the block itself if the ray started inside. */
  before: readonly [number, number, number];
  /** The ray's length to the face it entered through. */
  distance: number;
}

/** How far the player can reach, in blocks. */
export const REACH = 6;

/**
 * Walks from `origin` along `dir` (a unit vector) for at most `reach` blocks and returns the first cell whose block
 * `targetable` marks with 1. Cells of unloaded chunks end the walk, so a block cannot be picked through a gap.
 */
export function raycast(
  blocks: Blocks,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  targetable: Uint8Array,
  reach = REACH,
): Hit | null {
  const cell = origin.map(Math.floor) as [number, number, number];
  const step = dir.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
  // Distance along the ray to the next grid plane on each axis, and between planes.
  const next = dir.map((d, i) => (d === 0 ? Infinity : ((d > 0 ? cell[i]! + 1 : cell[i]!) - origin[i]!) / d));
  const span = dir.map((d) => (d === 0 ? Infinity : Math.abs(1 / d)));
  let before: [number, number, number] = [...cell];
  let travelled = 0;
  for (;;) {
    const id = blocks.block(cell[0], cell[1], cell[2]);
    if (id === UNLOADED) return null;
    if (targetable[id]) return { x: cell[0], y: cell[1], z: cell[2], before, distance: travelled };
    const axis = next[0]! < next[1]! ? (next[0]! < next[2]! ? 0 : 2) : next[1]! < next[2]! ? 1 : 2;
    travelled = next[axis]!;
    if (travelled > reach) return null;
    before = [...cell];
    cell[axis] += step[axis]!;
    next[axis]! += span[axis]!;
  }
}

/** A 256-entry table of the blocks that can be picked: everything but air, water and the not-loaded marker. */
export function targetTable(blocks: readonly { id: number; pass: string }[]): Uint8Array {
  const table = new Uint8Array(256);
  for (const block of blocks) table[block.id] = block.pass === 'water' ? 0 : 1;
  return table;
}

/** The unit vector a camera with this yaw and pitch looks along. Yaw 0 faces -z, as the player's walk does. */
export function lookDirection(yaw: number, pitch: number): [number, number, number] {
  const flat = Math.cos(pitch);
  return [-Math.sin(yaw) * flat, Math.sin(pitch), -Math.cos(yaw) * flat];
}

/** Whether a block at this cell would overlap a player standing at `x, y, z` (the centre of the feet). */
export function blocksPlayer(
  cell: readonly [number, number, number],
  player: { x: number; y: number; z: number },
  halfWidth: number,
  height: number,
): boolean {
  return (
    cell[0] < player.x + halfWidth &&
    cell[0] + 1 > player.x - halfWidth &&
    cell[1] < player.y + height &&
    cell[1] + 1 > player.y &&
    cell[2] < player.z + halfWidth &&
    cell[2] + 1 > player.z - halfWidth
  );
}
