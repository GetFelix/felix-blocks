// How far the player sees, in chunks. It follows the frame time: step down at the first sign the frame rate is
// slipping, step up only after a long steady stretch, and never straight back after a step down that was too eager.

/** The tiers, in chunks. */
export const MIN_TIER = 4;
export const MAX_TIER = 12;
/** The frame time the target frame rate allows. */
export const BUDGET_MS = 1000 / 60;

/** Frames the average is taken over. */
const WINDOW = 30;
/** Frames ignored after a change, while the chunks of the new distance load in and spike the frame time. */
const SETTLE = 20;
/** A mean this far over the budget is the frame rate slipping: about one frame in ten is late at 60 Hz. */
const SLIP = 1.1;
/** How long the frame time must hold at the budget before trying one tier further. */
const STEADY_MS = 5000;
/** The wait between step ups. A step up that has to be undone doubles it, a step up that held halves it again. */
const BACKOFF_MS = 15000;
const BACKOFF_MAX_MS = 120000;
/** A late frame counts as this many budgets at most, so one hitch or a tab switch cannot move the tier. */
const CLAMP = 3;
/** Frames a step up may keep waiting for its chunks to load; walking never stops the loading queue, so it is bounded. */
const LOAD_CAP = 600;

export interface TierChange {
  /** Milliseconds of frames recorded when it happened. */
  at: number;
  from: number;
  to: number;
  reason: 'slow' | 'steady';
  /** The mean frame time that decided it. */
  meanMs: number;
}

export interface ViewDistanceOptions {
  start?: number;
  min?: number;
  max?: number;
}

export class ViewDistance {
  readonly min: number;
  readonly max: number;
  readonly changes: TierChange[] = [];
  private current: number;
  private frames: number[] = [];
  private settle = SETTLE;
  /** True after a step up, until the new chunks are in. A step down only unloads, so it has nothing to wait for. */
  private loading = false;
  private held = 0;
  private elapsed = 0;
  private steadyFor = 0;
  private lastStepUp = -Infinity;
  /** The last step up has not yet been undone or held for a full wait. */
  private onTrial = false;
  private wait = BACKOFF_MS;

  constructor({ start = 8, min = MIN_TIER, max = MAX_TIER }: ViewDistanceOptions = {}) {
    this.min = min;
    this.max = max;
    this.current = Math.max(min, Math.min(max, start));
  }

  get tier(): number {
    return this.current;
  }

  /** The wait between step ups right now. */
  get retryAfterMs(): number {
    return this.wait;
  }

  /**
   * Feeds one frame's time and, if known, the number of chunks still loading. Returns the change if the tier moved.
   * A frame time that is not a positive number is ignored.
   */
  record(rawMs: number, pending = 0): TierChange | null {
    if (!Number.isFinite(rawMs) || rawMs <= 0) return null;
    const frameMs = Math.min(rawMs, BUDGET_MS * CLAMP);
    this.elapsed += frameMs;
    if (this.settle > 0) {
      const waiting = this.loading && pending > 0 && ++this.held < LOAD_CAP;
      if (!waiting) this.settle--;
      return null;
    }
    this.frames.push(frameMs);
    if (this.frames.length > WINDOW) this.frames.shift();
    if (this.frames.length < WINDOW) return null;
    const mean = this.frames.reduce((a, b) => a + b, 0) / WINDOW;

    if (mean > BUDGET_MS * SLIP) {
      // The cost of a frame follows the number of chunks in view, which follows the square of the tier.
      const fits = Math.floor(this.current * Math.sqrt(BUDGET_MS / mean));
      const to = Math.max(this.min, Math.min(this.current - 1, fits));
      if (to === this.current) return null;
      // A step up that did not hold: wait longer before the next one. Undoing it over two tiers counts once.
      if (this.onTrial && this.elapsed - this.lastStepUp < this.wait)
        this.wait = Math.min(BACKOFF_MAX_MS, this.wait * 2);
      this.onTrial = false;
      return this.move(to, 'slow', mean);
    }

    this.steadyFor += frameMs;
    const rested = this.elapsed - this.lastStepUp >= this.wait;
    if (this.steadyFor >= STEADY_MS && rested && this.current < this.max) {
      if (this.onTrial) this.wait = Math.max(BACKOFF_MS, this.wait / 2);
      this.onTrial = true;
      this.lastStepUp = this.elapsed;
      return this.move(this.current + 1, 'steady', mean);
    }
    return null;
  }

  private move(to: number, reason: TierChange['reason'], meanMs: number): TierChange {
    const change = { at: this.elapsed, from: this.current, to, reason, meanMs };
    this.current = to;
    this.changes.push(change);
    this.frames = [];
    this.loading = reason === 'steady';
    this.held = 0;
    this.settle = this.loading ? SETTLE : 0;
    this.steadyFor = 0;
    return change;
  }
}

/** Fog that finishes before the edge of the loaded chunks, so the end of the world never shows as an edge. */
export function fogFor(tier: number): { near: number; far: number } {
  const far = (tier - 1) * 16;
  return { near: far * 0.37, far };
}
