// Offline mode: the page talks to the in-memory stand-in for the gateway (`felix-gateway-client/fake`) and keeps what
// is written to it in IndexedDB. Nothing else in the page changes; it is the same code on a different transport. The
// keys and values are the ones Felix holds, so the world can be uploaded to Felix later.
import { FakeGateway, FakeScope } from 'felix-gateway-client/fake';
import { INFO_CACHE, infoKey, newWorldInfo } from './world-info';

/** The caches the world keeps: its info and the chunks players changed. */
const KEPT = [INFO_CACHE, 'chunks'];

export interface StoredEntry {
  cache: string;
  key: string;
  value: Uint8Array;
}

/** Where an offline world's entries are kept between visits. */
export interface EntryStore {
  /** Every entry of the world. */
  load(): Promise<StoredEntry[]>;
  /** Keeps an entry, or removes it when `value` is null. Resolves once it is kept. */
  save(cache: string, key: string, value: Uint8Array | null): Promise<void>;
}

export interface OfflineWorld {
  /** What the page uses in place of a gateway connection. */
  client: FakeGateway;
  /** Resolves once every write so far is kept in the store. */
  kept(): Promise<void>;
}

/**
 * Opens the offline world held by `store`. A world that is not there yet is made from `seed` and gets the same info
 * `blocks-tool create` would write; an existing one keeps the seed it was made with. `onError` hears about entries the
 * store could not keep. `loadGenerator` has to have finished.
 */
export async function openOfflineWorld(
  store: EntryStore,
  seed: number,
  onError: (error: unknown) => void = () => {},
): Promise<OfflineWorld> {
  const scope = new FakeScope();
  for (const entry of await store.load()) scope.writeCache(entry.cache, entry.key, entry.value);
  let pending: Promise<unknown> = Promise.resolve();
  const keep = (cache: string, key: string, value: Uint8Array | null) => {
    // One at a time, in the order of the writes, so the store ends up with the last one.
    pending = pending.then(() => store.save(cache, key, value)).catch(onError);
  };
  if (!scope.readCache(INFO_CACHE, infoKey())) {
    const info = newWorldInfo(seed);
    scope.writeCache(INFO_CACHE, infoKey(), info);
    keep(INFO_CACHE, infoKey(), info);
  }
  // A second connection that only listens, so every write by the page's own is kept.
  const recorder = new FakeGateway(scope);
  recorder.onCacheChange = (cache, entry) => keep(cache, entry.key, entry.payload);
  for (const cache of KEPT) recorder.cacheWatch(cache);
  return { client: new FakeGateway(scope), kept: async () => void (await pending) };
}

/** Entries in memory, for tests. */
export function memoryStore(entries: StoredEntry[] = []): EntryStore {
  const held = new Map(entries.map((e) => [`${e.cache}\0${e.key}`, e]));
  return {
    load: async () => [...held.values()],
    save: async (cache, key, value) => {
      if (value) held.set(`${cache}\0${key}`, { cache, key, value });
      else held.delete(`${cache}\0${key}`);
    },
  };
}

const DATABASE = 'felix-blocks-offline';
const OBJECTS = 'entries';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function opened(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OBJECTS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * The entries of the world called `world`, kept in this browser's IndexedDB. Worlds share one database, each under
 * its own key prefix.
 */
export function indexedDbStore(world: string): EntryStore {
  const prefix = `${world}\0`;
  const db = opened();
  const idbKey = (cache: string, key: string) => `${prefix}${cache}\0${key}`;
  return {
    async load() {
      const store = (await db).transaction(OBJECTS, 'readonly').objectStore(OBJECTS);
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range))]);
      return keys.map((full, i) => {
        const [cache, key] = String(full).slice(prefix.length).split('\0') as [string, string];
        return { cache, key, value: values[i] as Uint8Array };
      });
    },
    async save(cache, key, value) {
      const tx = (await db).transaction(OBJECTS, 'readwrite');
      if (value) tx.objectStore(OBJECTS).put(value, idbKey(cache, key));
      else tx.objectStore(OBJECTS).delete(idbKey(cache, key));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}
