import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadBlockTable } from './core';
import { HEIGHT, HALF_WIDTH, NO_INPUT, Player, type Input } from './player';
import { blocksOf, solidTable, UNLOADED, waterIds, type Blocks, type ChunkSource } from './solid';
import { createGeneratedWorld, loadGenerator, worldChunks } from './worldgen';

const wasm = readFileSync(new URL('./core/felix_blocks_core_bg.wasm', import.meta.url));
let solid: Uint8Array;
let water: Uint8Array;

beforeAll(async () => {
  const table = await loadBlockTable(wasm);
  await loadGenerator(wasm);
  solid = solidTable(table);
  water = waterIds(table);
});

const STONE = 3;
const WATER = 5;
const player = (x: number, y: number, z: number) => new Player(x, y, z, solid, water);
const input = (over: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...over });
const run = (p: Player, seconds: number, i: Input, blocks: Blocks, fps = 60) => {
  for (let n = 0; n < seconds * fps; n++) p.update(1 / fps, i, blocks);
};
/** Stone below y = 10, plus whatever `extra` says. */
const floor = (extra: (x: number, y: number, z: number) => boolean = () => false): Blocks => ({
  block: (x, y, z) => (Math.floor(y) < 10 || extra(Math.floor(x), Math.floor(y), Math.floor(z)) ? STONE : 0),
});

test('a player falls and lands on the floor', () => {
  const p = player(0.5, 20, 0.5);
  run(p, 3, input(), floor());
  expect(p.y).toBeCloseTo(10, 2);
  expect(p.onGround).toBe(true);
});

test('a long fall at a slow frame rate does not go through the floor', () => {
  const p = player(0.5, 200, 0.5);
  run(p, 20, input(), floor(), 4);
  expect(p.y).toBeCloseTo(10, 2);
});

test('walking stops at a wall and slides along it', () => {
  const wall = floor((x, y) => x >= 5 && y >= 10 && y < 14);
  const p = player(0.5, 10, 0.5);
  // Facing +x is a yaw of -90 degrees.
  run(p, 4, input({ forward: 1, yaw: -Math.PI / 2 }), wall);
  expect(p.x).toBeCloseTo(5 - HALF_WIDTH, 2);
  // Pushing into it at an angle keeps the sideways part.
  const z0 = p.z;
  run(p, 1, input({ forward: 1, right: -1, yaw: -Math.PI / 2 }), wall);
  expect(p.x).toBeCloseTo(5 - HALF_WIDTH, 2);
  expect(p.z).toBeLessThan(z0 - 2);
});

test('a jump clears one block but not two', () => {
  const step = (height: number) => floor((x, y) => x >= 3 && y < 10 + height);
  const walkAndJump = (height: number) => {
    const p = player(0.5, 10, 0.5);
    run(p, 3, input({ forward: 1, jump: true, yaw: -Math.PI / 2 }), step(height));
    run(p, 1, input(), step(height));
    return p;
  };
  const one = walkAndJump(1);
  expect(one.x).toBeGreaterThan(8);
  expect(one.y).toBeCloseTo(11, 2);
  const two = walkAndJump(2);
  expect(two.x).toBeCloseTo(3 - HALF_WIDTH, 2);
  expect(two.y).toBeCloseTo(10, 2);
});

test('walking without jumping does not climb a step', () => {
  const p = player(0.5, 10, 0.5);
  run(
    p,
    3,
    input({ forward: 1, yaw: -Math.PI / 2 }),
    floor((x, y) => x >= 3 && y === 10),
  );
  expect(p.x).toBeCloseTo(3 - HALF_WIDTH, 2);
});

test('a ceiling stops a jump', () => {
  const p = player(0.5, 10, 0.5);
  run(
    p,
    0.2,
    input({ jump: true }),
    floor((_x, y) => y >= 12),
  );
  expect(p.y + HEIGHT).toBeLessThanOrEqual(12);
  run(
    p,
    1,
    input(),
    floor((_x, y) => y >= 12),
  );
  expect(p.y).toBeCloseTo(10, 2);
});

test('going diagonally is not faster than straight', () => {
  const straight = player(0.5, 10, 0.5);
  const diagonal = player(0.5, 10, 0.5);
  run(straight, 2, input({ forward: 1 }), floor());
  run(diagonal, 2, input({ forward: 1, right: 1 }), floor());
  const d = (p: Player) => Math.hypot(p.x - 0.5, p.z - 0.5);
  expect(d(diagonal)).toBeCloseTo(d(straight), 2);
});

test('a chunk that has not arrived holds the player at its edge', () => {
  const missing: ChunkSource = { chunk: (_cx, cy) => (cy === 0 ? new Uint8Array(4096).fill(STONE) : null) };
  const blocks = blocksOf(missing, [8, 4, 8]);
  // The chunk above the floor is not loaded: nothing to stand in, so the player stays above it.
  expect(blocks.block(3, 20, 3)).toBe(UNLOADED);
  const p = player(3.5, 16.01, 3.5);
  run(p, 2, input(), blocks);
  expect(p.y).toBeGreaterThanOrEqual(16);
});

test('the edges of the world are walls and the sky above is open', () => {
  const air: ChunkSource = { chunk: () => new Uint8Array(4096) };
  const blocks = blocksOf(air, [2, 2, 2]);
  expect(blocks.block(-1, 5, 5)).toBe(UNLOADED);
  expect(blocks.block(5, 5, 32)).toBe(UNLOADED);
  expect(blocks.block(5, -1, 5)).toBe(UNLOADED);
  expect(blocks.block(5, 32, 5)).toBe(0);
  const p = player(1.5, 10, 1.5);
  run(p, 2, input({ forward: 1, right: -1, yaw: 0 }), blocks);
  expect(p.x).toBeGreaterThanOrEqual(HALF_WIDTH);
  expect(p.z).toBeGreaterThanOrEqual(HALF_WIDTH);
  run(p, 3, input(), blocks);
  expect(p.y).toBeGreaterThanOrEqual(0);
});

test('flying ignores gravity, moves up and down, and ends on landing', () => {
  const p = player(0.5, 30, 0.5);
  p.toggleFlying();
  run(p, 1, input(), floor());
  expect(p.y).toBeCloseTo(30, 5);
  run(p, 1, input({ jump: true }), floor());
  expect(p.y).toBeGreaterThan(35);
  run(p, 5, input({ down: true }), floor());
  expect(p.y).toBeCloseTo(10, 2);
  expect(p.flying).toBe(false);
});

test('water slows the fall and lets the player swim up', () => {
  const pool = { block: (_x: number, y: number) => (Math.floor(y) < 10 ? STONE : Math.floor(y) < 20 ? WATER : 0) };
  const p = player(0.5, 18, 0.5);
  run(p, 0.5, input(), pool);
  expect(p.inWater).toBe(true);
  expect(p.vy).toBeGreaterThan(-3.01);
  run(p, 3, input({ jump: true }), pool);
  expect(p.y).toBeGreaterThan(18);
});

test('straight walking keeps its speed across chunk boundaries', () => {
  const flat: ChunkSource = {
    chunk: (_cx, cy) => (cy === 0 ? new Uint8Array(4096).fill(STONE) : new Uint8Array(4096)),
  };
  const blocks = blocksOf(flat, [64, 4, 64]);
  const p = player(0.5, 16, 8.5);
  run(p, 20, input({ forward: 1, yaw: -Math.PI / 2 }), blocks);
  expect(p.x - 0.5).toBeCloseTo(4.3 * 20, 0);
  expect(p.y).toBeCloseTo(16, 2);
});

test('a player can walk across generated terrain without falling through or sticking', () => {
  const world = createGeneratedWorld(7);
  const size = Array.from(worldChunks()) as [number, number, number];
  const blocks = blocksOf(world, size);
  // From above the world's middle, dropped onto whatever is there.
  const p = player(2048.5, 140, 2048.5);
  run(p, 5, input(), blocks);
  expect(p.onGround).toBe(true);

  const inside = () => {
    for (let y = Math.floor(p.y); y < Math.ceil(p.y + HEIGHT); y++)
      for (let z = Math.floor(p.z - HALF_WIDTH); z < Math.ceil(p.z + HALF_WIDTH); z++)
        for (let x = Math.floor(p.x - HALF_WIDTH); x < Math.ceil(p.x + HALF_WIDTH); x++)
          if (solid[blocks.block(x, y, z)]) return true;
    return false;
  };
  // Walk east, jumping all the time. When a cliff, a tree or the water holds it up, turn by an awkward angle so it does not circle.
  let yaw = -Math.PI / 2;
  let [markX, markZ] = [p.x, p.z];
  const crossed = new Set<number>();
  const fps = 60;
  for (let n = 1; n <= 120 * fps; n++) {
    p.update(1 / fps, input({ forward: 1, jump: true, yaw }), blocks);
    expect(inside(), `inside a block at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(false);
    expect(p.y).toBeGreaterThan(0);
    crossed.add(Math.floor(p.x / 16) * 4096 + Math.floor(p.z / 16));
    if (n % (2 * fps) === 0) {
      // Two seconds of walking covers about 8 blocks; under 3 means it is held up.
      if (Math.hypot(p.x - markX, p.z - markZ) < 3) yaw += 2.4;
      [markX, markZ] = [p.x, p.z];
    }
  }
  // It kept moving over the chunk edges it met, instead of catching on one.
  expect(crossed.size).toBeGreaterThan(15);
});

test('a swimmer can climb out onto a bank level with the water', () => {
  const pool = {
    block: (x: number, y: number) => {
      const [bx, by] = [Math.floor(x), Math.floor(y)];
      if (bx >= 5) return by < 20 ? STONE : 0;
      return by < 10 ? STONE : by < 20 ? WATER : 0;
    },
  };
  const p = player(0.5, 12, 0.5);
  run(p, 20, input({ forward: 1, jump: true, yaw: -Math.PI / 2 }), pool);
  expect(p.x).toBeGreaterThan(6);
  expect(p.y).toBeGreaterThanOrEqual(20);
});

test('a standing player counts as on the ground at any frame rate', () => {
  for (const fps of [30, 60, 144, 1000]) {
    const p = player(0.5, 10, 0.5);
    run(p, 1, input(), floor(), fps);
    let grounded = 0;
    for (let n = 0; n < fps; n++) {
      p.update(1 / fps, input(), floor());
      if (p.onGround) grounded++;
    }
    expect(grounded, `${fps} fps`).toBe(fps);
  }
});
