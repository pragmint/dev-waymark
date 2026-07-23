import { describe, expect, it } from 'bun:test';
import { createTtlCache } from './queryCache';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('createTtlCache', () => {
  it('returns the cached value without calling factory again on a hit', async () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return 42;
    };

    expect(await cache.getOrCreate('a', factory)).toBe(42);
    expect(await cache.getOrCreate('a', factory)).toBe(42);
    expect(calls).toBe(1);
  });

  it('keeps distinct keys independent', async () => {
    const cache = createTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
    expect(await cache.getOrCreate('a', async () => 'valueA')).toBe('valueA');
    expect(await cache.getOrCreate('b', async () => 'valueB')).toBe('valueB');
    // Re-fetching 'a' must not have been clobbered by the 'b' write.
    expect(await cache.getOrCreate('a', async () => 'should-not-run')).toBe('valueA');
  });

  it('re-runs factory once an entry expires', async () => {
    const cache = createTtlCache<number>({ ttlMs: 1, maxEntries: 10 });
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.getOrCreate('a', factory)).toBe(1);
    await new Promise(r => setTimeout(r, 20));
    expect(await cache.getOrCreate('a', factory)).toBe(2);
    expect(calls).toBe(2);
  });

  it('de-dupes concurrent misses for the same key into a single factory call', async () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    let calls = 0;
    const { promise, resolve } = deferred<number>();
    const factory = async () => {
      calls += 1;
      return promise;
    };

    const p1 = cache.getOrCreate('a', factory);
    const p2 = cache.getOrCreate('a', factory);
    resolve(7);

    expect(await p1).toBe(7);
    expect(await p2).toBe(7);
    expect(calls).toBe(1);
  });

  it('lets a failed factory call be retried, without poisoning the cache', async () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    let calls = 0;
    const factory = async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return calls;
    };

    await expect(cache.getOrCreate('a', factory)).rejects.toThrow('boom');
    expect(await cache.getOrCreate('a', factory)).toBe(2);
  });

  it('evicts the least-recently-used entry once over capacity', async () => {
    const cache = createTtlCache<string>({ ttlMs: 10_000, maxEntries: 3 });
    await cache.getOrCreate('a', async () => 'A');
    await cache.getOrCreate('b', async () => 'B');
    await cache.getOrCreate('c', async () => 'C');
    await cache.getOrCreate('a', async () => 'should-not-run'); // touch 'a' — 'b' is now the LRU entry
    await cache.getOrCreate('d', async () => 'D'); // over capacity — evicts 'b'

    let bCalls = 0;
    await cache.getOrCreate('b', async () => {
      bCalls += 1;
      return 'B-refetched';
    });
    expect(bCalls).toBe(1); // 'b' had to be refetched — it was evicted

    let aCalls = 0;
    await cache.getOrCreate('a', async () => {
      aCalls += 1;
      return 'should-not-run';
    });
    expect(aCalls).toBe(0); // 'a' survived — it was touched more recently than 'b'
  });
});
