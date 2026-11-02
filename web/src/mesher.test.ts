import { expect, test } from 'vitest';
import { Mesher, type WorkerLike } from './mesher';
import type { MeshRequest } from './mesher.worker';
import type { ChunkMeshData } from './meshing';

const empty = {} as ChunkMeshData;

/** A worker that does nothing until the test answers it. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  jobs: MeshRequest[] = [];
  terminated = false;
  postMessage(message: MeshRequest) {
    this.jobs.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(id: number) {
    this.onmessage!({ data: { id, data: empty, ms: 1 } });
  }
}

function pool(workers: number) {
  const made: FakeWorker[] = [];
  const mesher = new Mesher({
    workers,
    create: () => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    },
  });
  return { mesher, made };
}

const chunks = [] as const;

test('never runs more jobs than there are workers, and starts the next as one finishes', async () => {
  const { mesher, made } = pool(2);
  const done = [1, 2, 3].map((n) => mesher.request(`c${n}`, chunks, n));
  expect(mesher.busy).toBe(2);
  expect(mesher.queued).toBe(1);
  const first = made.find((w) => w.jobs.some((j) => j.id === 1))!;
  first.answer(1);
  expect(await done[0]).not.toBeNull();
  expect(mesher.busy).toBe(2);
  expect(mesher.queued).toBe(0);
  expect(first.jobs.map((j) => j.id)).toEqual([1, 3]);
});

test('the nearest chunk goes first', () => {
  const { mesher, made } = pool(1);
  // Job ids count up from 1: start, far, near, middle.
  mesher.request('start', chunks, 0);
  mesher.request('far', chunks, 90);
  mesher.request('near', chunks, 1);
  mesher.request('middle', chunks, 10);
  const w = made[0]!;
  for (let i = 0; i < 3; i++) w.answer(w.jobs.at(-1)!.id);
  expect(w.jobs.map((j) => j.id)).toEqual([1, 3, 4, 2]);
});

test('a newer request for a chunk replaces one that has not started', async () => {
  const { mesher, made } = pool(1);
  mesher.request('busy', chunks);
  const stale = mesher.request('a', chunks);
  const fresh = mesher.request('a', chunks);
  expect(await stale).toBeNull();
  expect(mesher.queued).toBe(1);
  const w = made[0]!;
  w.answer(w.jobs.at(-1)!.id);
  w.answer(w.jobs.at(-1)!.id);
  expect(await fresh).not.toBeNull();
});

test('the result of a job that a newer request overtook is dropped', async () => {
  const { mesher, made } = pool(1);
  const running = mesher.request('a', chunks);
  const newer = mesher.request('a', chunks);
  const w = made[0]!;
  w.answer(w.jobs[0]!.id);
  expect(await running).toBeNull();
  w.answer(w.jobs[1]!.id);
  expect(await newer).not.toBeNull();
});

test('cancel drops a queued request and ignores a running one', async () => {
  const { mesher, made } = pool(1);
  const running = mesher.request('a', chunks);
  const queued = mesher.request('b', chunks);
  mesher.cancel('a');
  mesher.cancel('b');
  expect(await queued).toBeNull();
  made[0]!.answer(made[0]!.jobs[0]!.id);
  expect(await running).toBeNull();
  expect(mesher.queued).toBe(0);
});

test('a worker error rejects its job and the pool carries on with a fresh worker', async () => {
  const { mesher, made } = pool(1);
  const bad = mesher.request('a', chunks);
  const next = mesher.request('b', chunks);
  made[0]!.onmessage!({ data: { id: made[0]!.jobs[0]!.id, error: 'boom' } });
  await expect(bad).rejects.toThrow('boom');
  made[0]!.answer(made[0]!.jobs[1]!.id);
  expect(await next).not.toBeNull();

  const crashing = mesher.request('c', chunks);
  made[0]!.onerror!({ message: 'gone' });
  await expect(crashing).rejects.toThrow('gone');
  expect(made[0]!.terminated).toBe(true);
  expect(made).toHaveLength(2);
  void mesher.request('d', chunks);
  expect(made[1]!.jobs).toHaveLength(1);
});

test('dispose ends the workers and settles every request', async () => {
  const { mesher, made } = pool(1);
  const running = mesher.request('a', chunks);
  const queued = mesher.request('b', chunks);
  mesher.dispose();
  expect(await running).toBeNull();
  expect(await queued).toBeNull();
  expect(made[0]!.terminated).toBe(true);
  await expect(mesher.request('c', chunks)).rejects.toThrow('shut down');
});

test('a worker that dies while idle is replaced and never given a job', () => {
  const { mesher, made } = pool(2);
  made[0]!.onerror!({ message: 'gone' });
  expect(made[0]!.terminated).toBe(true);
  expect(made).toHaveLength(3);
  for (const key of ['a', 'b', 'c']) void mesher.request(key, chunks);
  expect(made[0]!.jobs).toHaveLength(0);
  expect(mesher.busy).toBe(2);
  expect(mesher.queued).toBe(1);
});

test('workers that cannot load are given up on, and every request settles', async () => {
  const { mesher, made } = pool(1);
  const jobs = ['a', 'b', 'c', 'd', 'e'].map((k) => mesher.request(k, chunks));
  // Each worker fails before it answers anything, like a script that does not load.
  for (let i = 0; i < 4; i++) made[i]!.onerror!({ message: 'no module' });
  for (const job of jobs.slice(0, 4)) await expect(job).rejects.toThrow('no module');
  await expect(jobs[4]).rejects.toThrow('keep failing');
  // The first worker and three replacements, then it stops instead of spawning forever.
  expect(made).toHaveLength(4);
  expect(mesher.queued).toBe(0);
  await expect(mesher.request('f', chunks)).rejects.toThrow('keep failing');
});

test('a finished job resets the count of failures in a row', async () => {
  const { mesher, made } = pool(1);
  for (let round = 0; round < 3; round++) {
    const w = made.at(-1)!;
    const ok = mesher.request(`ok${round}`, chunks);
    w.answer(w.jobs.at(-1)!.id);
    await ok;
    const bad = mesher.request(`bad${round}`, chunks);
    w.onerror!({ message: 'once' });
    await expect(bad).rejects.toThrow('once');
  }
  expect(made).toHaveLength(4);
  const w = made.at(-1)!;
  const ok = mesher.request('still works', chunks);
  w.answer(w.jobs.at(-1)!.id);
  expect(await ok).not.toBeNull();
});

test('prioritize moves a queued request ahead and leaves a running one alone', () => {
  const { mesher, made } = pool(1);
  mesher.request('running', chunks, 0);
  mesher.request('far', chunks, 50);
  mesher.request('near', chunks, 10);
  expect(mesher.prioritize('far', 1)).toBe(true);
  expect(mesher.prioritize('running', 1)).toBe(false);
  expect(mesher.prioritize('missing', 1)).toBe(false);
  const w = made[0]!;
  w.answer(w.jobs[0]!.id);
  // 'far' was request 2 and now has the lowest number, so it starts before 'near' (request 3).
  expect(w.jobs.map((j) => j.id)).toEqual([1, 2]);
});
