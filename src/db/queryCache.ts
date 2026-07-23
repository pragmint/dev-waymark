// Small TTL + LRU cache for expensive read queries whose result only depends
// on their arguments (e.g. filter-population aggregates). Not a general
// object cache — one instance should be created per logically-independent
// data source (see entityRepository.ts, which keys instances by source
// adapter so tests/instances never share state).
//
// getOrCreate() de-dupes concurrent misses on the same key: the first caller
// kicks off `factory()` and every concurrent caller for that key awaits the
// same in-flight promise, instead of each firing its own copy of an expensive
// query (a "thundering herd" on cache expiry).

type CacheEntry<T> = { value: T; expiresAt: number };

export type TtlCache<T> = {
  getOrCreate(key: string, factory: () => Promise<T>): Promise<T>;
};

export function createTtlCache<T>(opts: { ttlMs: number; maxEntries: number }): TtlCache<T> {
  const entries = new Map<string, CacheEntry<T>>();
  const pending = new Map<string, Promise<T>>();

  // Reading also bumps the entry to the end of the Map's iteration order,
  // making eviction (below) evict the least-recently-used entry rather than
  // just the least-recently-inserted one.
  function readFresh(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function store(key: string, value: T): void {
    if (!entries.has(key) && entries.size >= opts.maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey !== undefined) entries.delete(oldestKey);
    }
    entries.set(key, { value, expiresAt: Date.now() + opts.ttlMs });
  }

  return {
    async getOrCreate(key, factory) {
      const hit = readFresh(key);
      if (hit !== undefined) return hit;

      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const promise = factory()
        .then(value => {
          pending.delete(key);
          store(key, value);
          return value;
        })
        .catch(err => {
          pending.delete(key);
          throw err;
        });
      pending.set(key, promise);
      return promise;
    },
  };
}
