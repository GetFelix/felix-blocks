// Edits go to Felix in batches. A player's block is drawn at once as a pending change; every flush writes each changed
// chunk's delta with a conditional put at the version the client last saw. A refused write means someone else wrote the
// chunk first: take their value, lay the pending changes over it and write again. See "Editing a chunk" in
// docs/design.md.
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
}

/** Writes tried per chunk and flush before the rest waits for the next one. */
const MAX_ATTEMPTS = 5;
/** How long a chunk whose write failed is left alone, in milliseconds. */
const BACKOFF_MS = 1000;

interface Chunk {
  pos: ChunkPos;
  key: string;
  /** The blocks as far as the client knows Felix holds them. */
  confirmed: Uint8Array;
  /** The version `confirmed` was read or written at, 'absent' for no key, null when it must be read before a write. */
  version: number | 'absent' | null;
  /** The cells the player changed that Felix does not hold yet. */
  pending: Map<number, number>;
  /** The bytes this client last wrote, to tell its own watch echo from somebody else's write. */
  written: Uint8Array | null;
  busy: boolean;
  /** A value the watch delivered while a write was in flight (undefined: none; null: the key was deleted). */
  arrived: Uint8Array | null | undefined;
  retryAt: number;
}

export class EditSync {
  private readonly chunks = new Map<string, Chunk>();
  private readonly cache: string;
  private timer: ReturnType<typeof setInterval> | undefined;

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

  /** Writes every chunk with pending changes. Resolves when each has been written or has failed. */
  async flush(): Promise<void> {
    const due = [...this.chunks.values()].filter(
      (chunk) => chunk.pending.size > 0 && !chunk.busy && chunk.retryAt <= this.now(),
    );
    await Promise.all(due.map((chunk) => this.write(chunk)));
  }

  /**
   * Takes a value Felix holds for a chunk key (from a watch or a read): the chunk becomes that value with the pending
   * changes on top. `null` means the key was deleted. A value that cannot be read is skipped.
   */
  ingest(key: string, value: Uint8Array | null): void {
    const pos = chunkAt(key);
    if (!pos || !this.world.generated.chunk(...pos)) return;
    const chunk = this.state(...pos);
    if (chunk.busy) {
      chunk.arrived = value;
      return;
    }
    if (value && chunk.written && sameBytes(value, chunk.written)) return;
    this.take(chunk, value, null);
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
        written: null,
        busy: false,
        arrived: undefined,
        retryAt: 0,
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private async write(chunk: Chunk): Promise<void> {
    chunk.busy = true;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && chunk.pending.size > 0; attempt++) {
        if (chunk.version === null) {
          const entry = await this.gateway.cacheGetVersioned(this.cache, chunk.key);
          this.take(chunk, entry?.payload ?? null, entry ? entry.version : 'absent');
        }
        const sent = new Map(chunk.pending);
        const desired = chunk.confirmed.slice();
        for (const [cell, id] of sent) desired[cell] = id;
        const generated = this.world.generated;
        const value = encodeValue(generated.version, generated.chunk(...chunk.pos)!, desired);
        const condition = chunk.version === 'absent' ? 'absent' : { version: chunk.version! };
        const result = await this.gateway.cachePutIf(this.cache, chunk.key, value, condition);
        if (result.applied) {
          chunk.confirmed = desired;
          chunk.version = result.version;
          chunk.written = value;
          for (const [cell, id] of sent) if (chunk.pending.get(cell) === id) chunk.pending.delete(cell);
        } else {
          // Somebody wrote first. Read their value, and rebase on it at the top of the loop.
          chunk.version = null;
        }
      }
    } catch (error) {
      chunk.version = null;
      chunk.retryAt = this.now() + BACKOFF_MS;
      this.options.onError?.(error);
    } finally {
      chunk.busy = false;
    }
    if (chunk.arrived !== undefined) {
      const arrived = chunk.arrived;
      chunk.arrived = undefined;
      this.ingest(chunk.key, arrived);
    }
  }

  /**
   * Makes `value` the chunk's confirmed blocks. A pending change to a cell the new value changed is dropped, so the
   * other player's block stands; the rest stay on top. The chunk is redrawn if what the player sees changed.
   */
  private take(chunk: Chunk, value: Uint8Array | null, version: number | 'absent' | null): void {
    const [cx, cy, cz] = chunk.pos;
    const generated = this.world.generated;
    let next: Uint8Array;
    try {
      next = value ? decodeValue(value, generated.version, generated.chunk(cx, cy, cz)!) : generated.chunk(cx, cy, cz)!;
    } catch (error) {
      this.options.onError?.(error);
      return;
    }
    const before = chunk.confirmed;
    for (const cell of [...chunk.pending.keys()]) if (next[cell] !== before[cell]) chunk.pending.delete(cell);
    chunk.confirmed = next;
    chunk.version = version;
    if (value === null) chunk.written = null;
    const shown = next.slice();
    for (const [cell, id] of chunk.pending) shown[cell] = id;
    const current = this.world.chunk(cx, cy, cz)!;
    if (!sameBytes(shown, current)) {
      this.world.setChunk(cx, cy, cz, shown);
      this.options.onChanged?.(this.world.touched(cx, cy, cz));
    }
  }
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
