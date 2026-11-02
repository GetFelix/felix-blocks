// Edits go to Felix in batches. A player's block is drawn at once as a pending change; every flush writes each changed
// chunk's delta with a conditional put at the version the client last saw. A refused write means someone else wrote the
// chunk first: take their value, lay the pending changes over it and write again. The watch's values carry no version,
// so a watch change only marks the chunk to be read with its version; values are ordered by version, never by arrival.
// See "Editing a chunk" in docs/design.md.
import type { Gateway } from 'felix-gateway-client';
import { chunkOf, decodeValue, encodeValue, keyOf } from './chunk-store';
import { cellIndex, type ChunkPos, type EditableWorld } from './editable-world';

/** The part of the gateway client the sync uses, so tests can pass the fake. */
export type ChunkGateway = Pick<Gateway, 'cacheGetVersioned' | 'cachePutIf'>;

export interface EditSyncOptions {
  /** The alias of the chunk cache in the gateway's scope file. */
  cache?: string;
  /** Called with every chunk whose blocks changed, so its mesh can be rebuilt. */
  onChanged?: (chunks: ChunkPos[]) => void;
  /** Called when a write fails for a reason other than a refused condition. The edits stay pending and are tried again. */
  onError?: (error: unknown) => void;
  /**
   * Called when a stored value cannot be read as a chunk and the player has no unsaved edits in it, with its key. The
   * chunk keeps the generated blocks. Otherwise, and without this, the error goes to `onError`.
   */
  onBadValue?: (key: string, error: unknown) => void;
}

/** Writes tried per chunk and flush before the rest waits for the next one. */
const MAX_ATTEMPTS = 5;
/** How long a chunk whose write failed is left alone, in milliseconds. */
const BACKOFF_MS = 1000;
/** Chunks one flush starts, so a big save does not burst far past the gateway's write rate. */
const PER_FLUSH = 20;

interface Chunk {
  pos: ChunkPos;
  key: string;
  /** The blocks as far as the client knows Felix holds them. */
  confirmed: Uint8Array;
  /** The version `confirmed` was read or written at, 'absent' for no key, null when it must be read before a write. */
  version: number | 'absent' | null;
  /** The cells the player changed that Felix does not hold yet. */
  pending: Map<number, number>;
  /** The cells of a write that failed without an answer, so it may have applied. Reading them back is not a conflict. */
  maybe: Map<number, number> | null;
  /** The watch reported a change, so the key must be read with its version. */
  stale: boolean;
  busy: boolean;
  retryAt: number;
}

export class EditSync {
  private readonly chunks = new Map<string, Chunk>();
  private readonly cache: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** No flush starts a write before this time: the gateway said the session writes too fast. */
  private holdUntil = 0;

  constructor(
    private readonly world: EditableWorld,
    private readonly gateway: ChunkGateway,
    private readonly options: EditSyncOptions = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.cache = options.cache ?? 'chunks';
  }

  /** Changes one block now and queues it for the next flush. False if nothing changed. */
  edit(x: number, y: number, z: number, id: number): boolean {
    const touched = this.world.setBlock(x, y, z, id);
    if (touched.length === 0) return false;
    const chunk = this.state(x >> 4, y >> 4, z >> 4);
    chunk.pending.set(cellIndex(x, y, z), id);
    this.options.onChanged?.(touched);
    return true;
  }

  /** Whether any change has not reached Felix. */
  get dirty(): boolean {
    for (const chunk of this.chunks.values()) if (chunk.pending.size > 0 || chunk.busy) return true;
    return false;
  }

  /** Flushes every `ms` milliseconds until `stop`. */
  start(ms = 100): void {
    this.stop();
    this.timer = setInterval(() => void this.flush(), ms);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reads every chunk the watch reported and writes every chunk with pending changes. Resolves when each is done. */
  async flush(): Promise<void> {
    const now = this.now();
    if (now < this.holdUntil) return;
    const due = [...this.chunks.values()].filter(
      (chunk) => !chunk.busy && chunk.retryAt <= now && (chunk.stale || chunk.pending.size > 0),
    );
    await Promise.all(due.slice(0, PER_FLUSH).map((chunk) => this.step(chunk)));
  }

  /**
   * Takes a value from the cache's entries delivered on join: the chunk becomes that value with the pending changes on
   * top. `null` means the key has no value. A chunk the client already read is only marked to be read again, because
   * the value has no version to order it against what the client holds.
   */
  ingest(key: string, value: Uint8Array | null): void {
    const pos = chunkAt(key);
    if (!pos || !this.world.generated.chunk(...pos)) return;
    const chunk = this.state(...pos);
    if (chunk.busy || chunk.version !== null) chunk.stale = true;
    else this.take(chunk, value, null);
  }

  /** Marks a chunk the watch reported as changed, so the next flush reads it with its version. */
  changed(key: string): void {
    const pos = chunkAt(key);
    if (!pos || !this.world.generated.chunk(...pos)) return;
    this.state(...pos).stale = true;
  }

  private state(cx: number, cy: number, cz: number): Chunk {
    const key = keyOf(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const generated = this.world.generated.chunk(cx, cy, cz);
      if (!generated) throw new RangeError(`chunk ${cx},${cy},${cz} is outside the world`);
      chunk = {
        pos: [cx, cy, cz],
        key,
        confirmed: generated,
        // Nothing is known about the key until it is read; a chunk nobody edited has none.
        version: null,
        pending: new Map(),
        maybe: null,
        stale: false,
        busy: false,
        retryAt: 0,
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** Reads the chunk if it is stale, then writes its pending changes. Only one step runs per chunk at a time. */
  private async step(chunk: Chunk): Promise<void> {
    chunk.busy = true;
    let reading = false;
    try {
      if (chunk.stale) {
        // Cleared first, so a change reported during the read marks the chunk again.
        chunk.stale = false;
        reading = true;
        if (!(await this.refresh(chunk))) return this.backoff(chunk);
        reading = false;
      }
      if (chunk.pending.size > 0) await this.write(chunk);
    } catch (error) {
      if (reading) chunk.stale = true;
      const wait = rateLimitWait(error);
      if (wait !== null) {
        // Refused before it reached Felix, so nothing is wrong with the chunk. The edits wait for the gateway's bucket.
        this.holdUntil = Math.max(this.holdUntil, this.now() + wait);
        chunk.maybe = null;
        return;
      }
      this.backoff(chunk);
      this.options.onError?.(error);
    } finally {
      chunk.busy = false;
    }
  }

  /** Takes the stored value if its version is not the one the client holds. False if it could not be read. */
  private async refresh(chunk: Chunk): Promise<boolean> {
    const entry = await this.gateway.cacheGetVersioned(this.cache, chunk.key);
    // An equal version is the client's own write coming back.
    if (entry) return entry.version === chunk.version || this.take(chunk, entry.payload, entry.version);
    return chunk.version === 'absent' || this.take(chunk, null, 'absent');
  }

  private async write(chunk: Chunk): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS && chunk.pending.size > 0; attempt++) {
      if (chunk.version === null) {
        const entry = await this.gateway.cacheGetVersioned(this.cache, chunk.key);
        if (!this.take(chunk, entry?.payload ?? null, entry ? entry.version : 'absent')) return this.backoff(chunk);
        if (chunk.pending.size === 0) return;
      }
      const version = chunk.version;
      // Never write without a version: the put would not be conditional on what the client rebased on.
      if (version === null) return this.backoff(chunk);
      const sent = new Map(chunk.pending);
      const desired = chunk.confirmed.slice();
      for (const [cell, id] of sent) desired[cell] = id;
      const generated = this.world.generated;
      const value = encodeValue(generated.version, generated.chunk(...chunk.pos)!, desired);
      // Kept if the put throws, since it may still have applied.
      chunk.maybe = sent;
      const result = await this.gateway.cachePutIf(
        this.cache,
        chunk.key,
        value,
        version === 'absent' ? 'absent' : { version },
      );
      chunk.maybe = null;
      if (result.applied) {
        chunk.confirmed = desired;
        chunk.version = result.version;
        for (const [cell, id] of sent) if (chunk.pending.get(cell) === id) chunk.pending.delete(cell);
      } else {
        // Somebody wrote first. Read their value, and rebase on it at the top of the loop.
        chunk.version = null;
      }
    }
  }

  private backoff(chunk: Chunk): void {
    chunk.version = null;
    chunk.retryAt = this.now() + BACKOFF_MS;
  }

  /**
   * Makes `value` the chunk's confirmed blocks at `version`. A pending change to a cell the new value changed is
   * dropped, so the other player's block stands; the rest stay on top. The chunk is redrawn if what the player sees
   * changed. False, with the error reported, if the value cannot be read.
   */
  private take(chunk: Chunk, value: Uint8Array | null, version: number | 'absent' | null): boolean {
    const [cx, cy, cz] = chunk.pos;
    const generated = this.world.generated;
    let next: Uint8Array;
    try {
      next = value ? decodeValue(value, generated.version, generated.chunk(cx, cy, cz)!) : generated.chunk(cx, cy, cz)!;
    } catch (error) {
      chunk.version = null;
      // Only a chunk with unsaved edits is a failed save; otherwise the player just sees the generated blocks.
      if (chunk.pending.size === 0 && this.options.onBadValue) this.options.onBadValue(chunk.key, error);
      else this.options.onError?.(error);
      return false;
    }
    const before = chunk.confirmed;
    for (const cell of [...chunk.pending.keys()]) {
      // A cell that holds what our unanswered write sent is our own write read back, not another player's.
      if (next[cell] !== before[cell] && chunk.maybe?.get(cell) !== next[cell]) chunk.pending.delete(cell);
    }
    chunk.maybe = null;
    chunk.confirmed = next;
    chunk.version = version;
    const shown = next.slice();
    for (const [cell, id] of chunk.pending) shown[cell] = id;
    const current = this.world.chunk(cx, cy, cz)!;
    if (!sameBytes(shown, current)) {
      this.world.setChunk(cx, cy, cz, shown);
      this.options.onChanged?.(this.world.touched(cx, cy, cz));
    }
    return true;
  }
}

/** How long the gateway wants the session to wait, if the error is its `rate_limited` refusal. */
function rateLimitWait(error: unknown): number | null {
  const refused = error as { code?: unknown; retryAfterMs?: unknown } | null;
  if (refused?.code !== 'rate_limited') return null;
  return typeof refused.retryAfterMs === 'number' ? Math.max(refused.retryAfterMs, 250) : BACKOFF_MS;
}

function chunkAt(key: string): ChunkPos | null {
  const pos = chunkOf(key);
  return pos ? [pos[0], pos[1], pos[2]] : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
