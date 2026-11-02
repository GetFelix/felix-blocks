// The page's side of meshing: a small pool of workers and a queue in front of it. The nearest chunks go first, and a
// chunk that changes again before its job starts is only meshed once.
import type { MeshRequest, MeshResponse } from './mesher.worker';
import type { ChunkMeshData, ChunkNeighbourhood } from './meshing';

export interface MeshResult {
  data: ChunkMeshData;
  /** Time spent meshing inside the worker. */
  ms: number;
}

/** The part of `Worker` the pool uses, so tests can stand in for it. */
export interface WorkerLike {
  onmessage: ((e: { data: MeshResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  postMessage(message: MeshRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface Job {
  id: number;
  key: string;
  chunks: ChunkNeighbourhood;
  priority: number;
  resolve: (r: MeshResult | null) => void;
  reject: (e: Error) => void;
}

const createWorker = (): WorkerLike =>
  new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class Mesher {
  private readonly create: () => WorkerLike;
  private readonly idle: WorkerLike[] = [];
  private readonly running = new Map<WorkerLike, Job>();
  private queue: Job[] = [];
  /** The newest request per key; a job that is not it is stale when it finishes. */
  private readonly latest = new Map<string, Job>();
  private nextId = 1;
  private done = false;

  constructor(options: { workers?: number; create?: () => WorkerLike } = {}) {
    this.create = options.create ?? createWorker;
    const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
    const count = options.workers ?? Math.max(1, Math.min(4, cores - 2));
    for (let i = 0; i < count; i++) this.idle.push(this.spawn());
  }

  /** Chunks waiting for a worker. */
  get queued(): number {
    return this.queue.length;
  }

  /** Chunks being meshed right now. */
  get busy(): number {
    return this.running.size;
  }

  /**
   * Meshes `chunks`, the chunk at index 13 and its neighbours. Lower `priority` goes first; use the squared distance
   * from the player. Resolves with null if a newer request for `key` replaced this one, or it was cancelled.
   */
  request(key: string, chunks: ChunkNeighbourhood, priority = 0): Promise<MeshResult | null> {
    if (this.done) return Promise.reject(new Error('the mesher is shut down'));
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, key, chunks, priority, resolve, reject };
      const queuedBefore = this.queue.findIndex((j) => j.key === key);
      if (queuedBefore >= 0) this.queue.splice(queuedBefore, 1)[0]!.resolve(null);
      this.latest.set(key, job);
      this.queue.push(job);
      this.pump();
    });
  }

  /** Drops a queued request, and the result of a running one. */
  cancel(key: string): void {
    this.latest.delete(key);
    const i = this.queue.findIndex((j) => j.key === key);
    if (i >= 0) this.queue.splice(i, 1)[0]!.resolve(null);
  }

  dispose(): void {
    this.done = true;
    for (const w of [...this.idle, ...this.running.keys()]) w.terminate();
    for (const job of [...this.queue, ...this.running.values()]) job.resolve(null);
    this.idle.length = 0;
    this.running.clear();
    this.queue = [];
    this.latest.clear();
  }

  private spawn(): WorkerLike {
    const w = this.create();
    w.onmessage = (e) => this.finish(w, e.data);
    w.onerror = (e) =>
      this.crash(w, new Error(`the meshing worker failed: ${String((e as ErrorEvent)?.message ?? e)}`));
    return w;
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      let best = 0;
      this.queue.forEach((j, i) => {
        if (j.priority < this.queue[best]!.priority) best = i;
      });
      const job = this.queue.splice(best, 1)[0]!;
      const worker = this.idle.pop()!;
      this.running.set(worker, job);
      worker.postMessage({ id: job.id, chunks: job.chunks }, []);
    }
  }

  private release(worker: WorkerLike): Job | undefined {
    const job = this.running.get(worker);
    this.running.delete(worker);
    return job;
  }

  private finish(worker: WorkerLike, reply: MeshResponse): void {
    const job = this.release(worker);
    if (this.done) return;
    this.idle.push(worker);
    if (job) {
      const current = this.latest.get(job.key) === job;
      if (current) this.latest.delete(job.key);
      if ('error' in reply) job.reject(new Error(reply.error));
      else job.resolve(current ? { data: reply.data, ms: reply.ms } : null);
    }
    this.pump();
  }

  private crash(worker: WorkerLike, error: Error): void {
    const job = this.release(worker);
    worker.terminate();
    if (this.done) return;
    this.idle.push(this.spawn());
    if (job) {
      if (this.latest.get(job.key) === job) this.latest.delete(job.key);
      job.reject(error);
    }
    this.pump();
  }
}
