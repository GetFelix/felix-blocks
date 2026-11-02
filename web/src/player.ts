// The player's body: a box that walks, jumps, swims and flies through blocks. Pure maths over a `Blocks`, so it runs
// in tests and does not know about the renderer.
import type { Blocks } from './solid';

export const HALF_WIDTH = 0.3;
export const HEIGHT = 1.8;
/** Height of the eyes above the feet. */
export const EYE = 1.62;

const GRAVITY = 28;
const TERMINAL = 50;
const WALK = 4.3;
const SPRINT = 6.2;
const FLY = 10.9;
// Jumps just over a block and a quarter: v^2 / (2 g).
const JUMP = 8.4;
const SWIM_UP = 3.5;
const SWIM_SINK = 3;
const SWIM_GRAVITY = 6;
const SWIM_SLOWDOWN = 0.6;
// A block is never crossed in one go, so a fast fall cannot skip a floor.
const MAX_MOVE = 0.25;
const MAX_STEP = 1 / 30;
// How far a box stays off the face it stopped at, so the next test does not see it as inside.
const EPS = 1e-4;

export interface Input {
  /** -1 to 1: forward, and to the right. */
  forward: number;
  right: number;
  /** Jump, swim up, or rise when flying. */
  jump: boolean;
  /** Sink when flying. */
  down: boolean;
  sprint: boolean;
  /** Heading in radians; 0 faces -z, and a positive yaw turns left. */
  yaw: number;
}

export const NO_INPUT: Input = { forward: 0, right: 0, jump: false, down: false, sprint: false, yaw: 0 };

export class Player {
  /** The centre of the feet. */
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  onGround = false;
  flying = false;
  inWater = false;

  constructor(
    x: number,
    y: number,
    z: number,
    private readonly solid: Uint8Array,
    private readonly water: Uint8Array,
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Where the eyes are. */
  get eyeY(): number {
    return this.y + EYE;
  }

  /** Moves to a place and stops. */
  teleport(x: number, y: number, z: number): void {
    [this.x, this.y, this.z] = [x, y, z];
    this.vx = this.vy = this.vz = 0;
  }

  toggleFlying(): void {
    this.flying = !this.flying;
    this.vy = 0;
  }

  /** Advances by `dt` seconds. A long frame is taken as several short steps. */
  update(dt: number, input: Input, blocks: Blocks): void {
    for (let left = Math.min(dt, 0.25); left > 1e-6; ) {
      const step = Math.min(left, MAX_STEP);
      this.step(step, input, blocks);
      left -= step;
    }
  }

  private step(dt: number, input: Input, blocks: Blocks): void {
    this.inWater = this.waterAt(blocks, this.y + 0.4);
    const swimming = this.inWater && !this.flying;
    const speed = this.flying ? FLY : input.sprint ? SPRINT : WALK;
    const scale = swimming ? SWIM_SLOWDOWN : 1;
    // Facing -z at yaw 0; right is +x.
    const [sin, cos] = [Math.sin(input.yaw), Math.cos(input.yaw)];
    let [wx, wz] = [-sin * input.forward + cos * input.right, -cos * input.forward - sin * input.right];
    const length = Math.hypot(wx, wz);
    if (length > 1) [wx, wz] = [wx / length, wz / length];
    this.vx = wx * speed * scale;
    this.vz = wz * speed * scale;

    if (this.flying) {
      this.vy = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * FLY;
    } else if (swimming) {
      this.vy = input.jump ? SWIM_UP : Math.max(this.vy - SWIM_GRAVITY * dt, -SWIM_SINK);
    } else {
      if (input.jump && this.onGround) this.vy = JUMP;
      this.vy = Math.max(this.vy - GRAVITY * dt, -TERMINAL);
    }

    this.onGround = false;
    // Sideways first, so a wall stops that axis without stopping the fall.
    this.move(0, this.vx * dt, blocks);
    this.move(2, this.vz * dt, blocks);
    this.move(1, this.vy * dt, blocks);
    if (this.flying && this.onGround) this.flying = false;
  }

  /** Moves along one axis (0 x, 1 y, 2 z), in short hops, stopping at the face of whatever blocks it. */
  private move(axis: 0 | 1 | 2, delta: number, blocks: Blocks): void {
    const hops = Math.max(1, Math.ceil(Math.abs(delta) / MAX_MOVE));
    for (let i = 0; i < hops; i++) {
      if (!this.hop(axis, delta / hops, blocks)) return;
    }
  }

  private hop(axis: 0 | 1 | 2, delta: number, blocks: Blocks): boolean {
    if (delta === 0) return true;
    const pos = [this.x, this.y, this.z];
    pos[axis]! += delta;
    // The cells the box now overlaps.
    const [lo, hi] = [pos[0]! - HALF_WIDTH, pos[0]! + HALF_WIDTH];
    const [zlo, zhi] = [pos[2]! - HALF_WIDTH, pos[2]! + HALF_WIDTH];
    const [ylo, yhi] = [pos[1]!, pos[1]! + HEIGHT];
    for (let by = Math.floor(ylo); by < Math.ceil(yhi); by++)
      for (let bz = Math.floor(zlo); bz < Math.ceil(zhi); bz++)
        for (let bx = Math.floor(lo); bx < Math.ceil(hi); bx++) {
          if (!this.solid[blocks.block(bx, by, bz)]) continue;
          // Stopped: stand against the face of this cell.
          const cell = [bx, by, bz][axis]!;
          if (axis === 1) {
            if (delta < 0) {
              this.y = cell + 1 + EPS;
              this.onGround = true;
            } else {
              this.y = cell - HEIGHT - EPS;
            }
            this.vy = 0;
          } else {
            const edge = delta > 0 ? cell - HALF_WIDTH - EPS : cell + 1 + HALF_WIDTH + EPS;
            if (axis === 0) [this.x, this.vx] = [edge, 0];
            else [this.z, this.vz] = [edge, 0];
          }
          return false;
        }
    [this.x, this.y, this.z] = pos as [number, number, number];
    return true;
  }

  private waterAt(blocks: Blocks, y: number): boolean {
    return this.water[blocks.block(this.x, y, this.z)] === 1;
  }
}
