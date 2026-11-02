// What a world's info value tells the page: how to generate the terrain and where to stand first. The value is made
// by `blocks-tool create` (core/src/info.rs) and read once, on join.
import { groundHeight, WorldInfo, worldChunks, worldInfoKey } from './core/felix_blocks_core.js';

/** The cache the info is stored in (its alias in the gateway's scope file) and the key it sits under. */
export const INFO_CACHE = 'info';
/** The key the info sits under. */
export const infoKey = worldInfoKey;

export interface WorldStart {
  seed: number;
  /** The generator version the world was made with. */
  version: number;
  /** The block the player's feet start in: x, y (up) and z. */
  spawn: [number, number, number];
}

/** The start of a new world made from `seed`, as `blocks-tool create` would make it. `loadGenerator` has to have finished. */
export function newWorldStart(seed: number): WorldStart {
  return startOf(newInfo(seed));
}

/** The info value of a new world, as `blocks-tool create` writes it. Throws if the seed is not a whole number from 0 to 2^32 - 1. */
export function newWorldInfo(seed: number): Uint8Array {
  return newInfo(seed).encode();
}

function newInfo(seed: number): WorldInfo {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError(`seed ${seed} is not a u32`);
  return WorldInfo.create(seed);
}

/**
 * Reads a stored info value. Throws, saying why, if it is not an info value, if the world is not the size this build
 * generates, or if its generator version is not one this build has.
 */
export function readWorldInfo(value: Uint8Array): WorldStart {
  return startOf(WorldInfo.decode(value));
}

function startOf(info: WorldInfo): WorldStart {
  const [x, y, z] = Array.from(info.size);
  const here = Array.from(worldChunks());
  if (x !== here[0] || y !== here[1] || z !== here[2]) {
    throw new Error(`this world is ${x} x ${y} x ${z} chunks; this build makes ${here.join(' x ')}`);
  }
  try {
    groundHeight(info.generatorVersion, info.seed, 0, 0);
  } catch {
    throw new Error(
      `this world was made by terrain generator ${info.generatorVersion}, which this build does not have`,
    );
  }
  const [sx, sy, sz] = Array.from(info.spawn) as [number, number, number];
  return { seed: info.seed, version: info.generatorVersion, spawn: [sx, sy, sz] };
}
