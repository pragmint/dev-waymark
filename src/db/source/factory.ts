import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../../config';
import { parseSqliteUrl } from '../../config';
import type { SourceDataAdapter } from './adapter';
import { SqliteSourceAdapter } from './sqlite';
import { PostgresSourceAdapter } from './postgres';
import { RedshiftSourceAdapter } from './redshift';
import { seedGoldenData } from './goldenSeed';
import { seedE2EData } from './e2eSeed';

// Snapshot of the seeded in-memory dataset. Stored as raw sqlite bytes plus a
// plain-text sidecar holding a content hash of the seed source + schema DDL —
// any edit to either invalidates the snapshot on next boot. Gitignored;
// rebuilt on demand. Only used when no source DB is configured.
//
// Snapshots are loaded via `Database.deserialize()` into a fresh in-memory DB
// rather than opened in place — that keeps the runtime semantics identical to
// the prior `:memory:` default and avoids file-lock / WAL-sidecar headaches
// when the snapshot is rebuilt (the macOS SQLITE_IOERR_VNODE trap).
const SEED_CACHE_PATH = join(process.cwd(), '.cache', 'dev-waymark-seed.sqlite');
const SEED_HASH_PATH = SEED_CACHE_PATH + '.hash';
const SEED_HASH_SOURCES = [
  join(import.meta.dir, 'goldenSeed.ts'),
  join(import.meta.dir, 'schema.ts'),
];

function computeSeedSourceHash(): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const path of SEED_HASH_SOURCES) hasher.update(readFileSync(path));
  return hasher.digest('hex').slice(0, 16);
}

function isCacheValid(expectedHash: string): boolean {
  if (!existsSync(SEED_CACHE_PATH) || !existsSync(SEED_HASH_PATH)) return false;
  try {
    return readFileSync(SEED_HASH_PATH, 'utf8').trim() === expectedHash;
  } catch {
    return false;
  }
}

async function buildSeedCache(hash: string): Promise<SqliteSourceAdapter> {
  // Seed into an in-memory DB, snapshot the bytes to disk, then keep using
  // the same in-memory DB for this process.
  const adapter = new SqliteSourceAdapter(':memory:', true);
  await seedGoldenData(adapter);

  mkdirSync(dirname(SEED_CACHE_PATH), { recursive: true });
  // Remove the hash file first, then write the snapshot, then write the hash.
  // If we crash partway through, next boot will see the missing hash and
  // re-seed. Synchronous fs calls are used deliberately — Bun.write can
  // resolve before bytes hit disk, which corrupts the cache.
  try {
    rmSync(SEED_HASH_PATH);
  } catch {
    // Missing is fine.
  }
  writeFileSync(SEED_CACHE_PATH, adapter.getDb().serialize());
  writeFileSync(SEED_HASH_PATH, hash);
  return adapter;
}

function loadFromSnapshot(): SqliteSourceAdapter {
  const bytes = readFileSync(SEED_CACHE_PATH);
  return new SqliteSourceAdapter(Database.deserialize(bytes));
}

async function loadInMemorySeed(): Promise<SqliteSourceAdapter> {
  const hash = computeSeedSourceHash();
  if (isCacheValid(hash)) return loadFromSnapshot();
  return buildSeedCache(hash);
}

async function loadE2ESeed(): Promise<SqliteSourceAdapter> {
  // ~30 rows — seeds in milliseconds, no disk cache needed.
  const adapter = new SqliteSourceAdapter(':memory:', true);
  await seedE2EData(adapter);
  return adapter;
}

export async function createSourceAdapter(
  config: Config['sourceDb'],
  options: { testMode?: boolean } = {}
): Promise<SourceDataAdapter> {
  switch (config.adapter) {
    case 'sqlite': {
      const path = parseSqliteUrl(config.url);
      // Apply the source schema automatically only for in-memory databases.
      // Configured file-based or external databases are assumed to have the
      // schema already — Dev Waymark never migrates a source database.
      if (path === ':memory:') return options.testMode ? loadE2ESeed() : loadInMemorySeed();
      return new SqliteSourceAdapter(path, false);
    }
    case 'postgres':
      return new PostgresSourceAdapter(config.url);
    case 'redshift':
      return new RedshiftSourceAdapter(config.url);
    default: {
      const _exhaustive: never = config.adapter;
      throw new Error(`Unknown source adapter: ${_exhaustive}`);
    }
  }
}
