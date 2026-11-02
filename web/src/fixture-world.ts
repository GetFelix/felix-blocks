// A small made-up world for the check pages and tests: hills, a lake, trees and a house with windows. The game
// generates its chunks in core/ from the world's seed; this only needs to give the mesher and the shaders something
// to draw, so it does not have to match it.
import type { ChunkNeighbourhood } from './meshing';

export const CHUNK = 16;
const AIR = 0;

export interface FixtureWorld {
  /** Chunks along x and z, and up. */
  size: readonly [number, number, number];
  chunk(cx: number, cy: number, cz: number): Uint8Array | null;
  /** The chunk and its 26 neighbours, for the mesher. Chunks outside the world are missing. */
  neighbourhood(cx: number, cy: number, cz: number): ChunkNeighbourhood;
  /** Height of the highest solid block in a column. */
  surface(x: number, z: number): number;
}

/** Block ids by name, from the block table. */
export type BlockIds = Record<string, number>;

const hash = (x: number, z: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Value noise on a grid of `cell` blocks, smoothly blended. */
function noise(x: number, z: number, cell: number, seed: number) {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = x / cell - gx;
  const fz = z / cell - gz;
  const s = (t: number) => t * t * (3 - 2 * t);
  const top = hash(gx, gz, seed) * (1 - s(fx)) + hash(gx + 1, gz, seed) * s(fx);
  const bottom = hash(gx, gz + 1, seed) * (1 - s(fx)) + hash(gx + 1, gz + 1, seed) * s(fx);
  return top * (1 - s(fz)) + bottom * s(fz);
}

export function createFixtureWorld(ids: BlockIds, size: readonly [number, number, number] = [8, 3, 8]): FixtureWorld {
  const [cxs, cys, czs] = size;
  const W = cxs * CHUNK;
  const H = cys * CHUNK;
  const D = czs * CHUNK;
  const blocks = new Uint8Array(W * H * D);
  const at = (x: number, y: number, z: number) => (y * D + z) * W + x;
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D;
  const set = (x: number, y: number, z: number, id: number) => {
    if (inside(x, y, z)) blocks[at(x, y, z)] = id;
  };
  const SEA = 15;

  const height = new Int32Array(W * D);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const hills = noise(x, z, 40, 1) * 0.7 + noise(x, z, 14, 2) * 0.3;
      height[z * W + x] = Math.round(10 + hills * 18);
    }

  // A flat plot for the house.
  const plot = { x: Math.floor(W / 2) - 4, z: Math.floor(D / 2) - 3, w: 9, d: 7 };
  const plotY = 19;
  for (let z = plot.z - 2; z < plot.z + plot.d + 2; z++)
    for (let x = plot.x - 2; x < plot.x + plot.w + 2; x++) height[z * W + x] = plotY;

  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const h = height[z * W + x]!;
      const beach = h <= SEA + 1;
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = ids.Stone!;
        if (y > h) id = ids.Water!;
        else if (y === h) id = beach ? ids.Sand! : ids.Grass!;
        else if (y >= h - 3) id = beach ? ids.Sand! : ids.Dirt!;
        set(x, y, z, id);
      }
    }

  // Trees where the hash says so, on grass, and not on the plot.
  for (let z = 3; z < D - 3; z++)
    for (let x = 3; x < W - 3; x++) {
      const h = height[z * W + x]!;
      const onPlot = x > plot.x - 4 && x < plot.x + plot.w + 4 && z > plot.z - 4 && z < plot.z + plot.d + 4;
      if (h <= SEA + 1 || onPlot || hash(x, z, 9) > 0.012) continue;
      const trunk = 4 + Math.floor(hash(x, z, 10) * 2);
      for (let y = 1; y <= trunk; y++) set(x, h + y, z, ids['Oak log']!);
      for (let dy = -1; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const r = dx * dx + dz * dz + dy * dy;
            const [lx, ly, lz] = [x + dx, h + trunk + dy, z + dz];
            if (r <= 6 && inside(lx, ly, lz) && blocks[at(lx, ly, lz)] === AIR) set(lx, ly, lz, ids.Leaves!);
          }
    }

  // The house: planks, a roof, glass windows, a door gap.
  for (let dz = 0; dz < plot.d; dz++)
    for (let dx = 0; dx < plot.w; dx++)
      for (let dy = 1; dy <= 5; dy++) {
        const wall = dx === 0 || dz === 0 || dx === plot.w - 1 || dz === plot.d - 1;
        const roof = dy === 5;
        if (!wall && !roof) continue;
        const window =
          dy >= 2 &&
          dy <= 3 &&
          !roof &&
          ((dx % 4 === 2 && (dz === 0 || dz === plot.d - 1)) || (dz === 3 && (dx === 0 || dx === plot.w - 1)));
        const door = dx === 4 && dz === plot.d - 1 && dy <= 2;
        set(plot.x + dx, plotY + dy, plot.z + dz, door ? AIR : window ? ids.Glass! : ids['Oak planks']!);
      }

  const read = (cx: number, cy: number, cz: number) => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= cxs || cy >= cys || cz >= czs) return null;
    const out = new Uint8Array(CHUNK ** 3);
    for (let y = 0; y < CHUNK; y++)
      for (let z = 0; z < CHUNK; z++) {
        const from = at(cx * CHUNK, cy * CHUNK + y, cz * CHUNK + z);
        out.set(blocks.subarray(from, from + CHUNK), (y << 8) | (z << 4));
      }
    return out;
  };

  return {
    size,
    chunk: read,
    neighbourhood(cx, cy, cz) {
      const out: (Uint8Array | null)[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(read(cx + dx, cy + dy, cz + dz));
      return out;
    },
    surface(x, z) {
      return Math.max(
        height[Math.max(0, Math.min(D - 1, Math.floor(z))) * W + Math.max(0, Math.min(W - 1, Math.floor(x)))]!,
        SEA,
      );
    },
  };
}
