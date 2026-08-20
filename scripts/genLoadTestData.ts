/**
 * Generates synthetic entities + metadata at load-test volumes, writing into
 * whichever source database is configured via .env (DEV_WAYMARK_SOURCE_DB_*).
 * Supports sqlite, postgres, and redshift — same adapters the app itself uses.
 *
 * Usage: bun scripts/genLoadTestData.ts
 */

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync } from 'node:fs';
import { Pool } from 'pg';
import { loadConfig, parseSqliteUrl } from '../src/config';
import { SOURCE_SCHEMA_DDL, POSTGRES_SOURCE_SCHEMA_DDL } from '../src/db/source/schema';
import { confirmDestructiveSeed, maskConnectionTarget } from '../src/db/source/confirmDestructive';

const DEFAULT_SQLITE_PATH = './big-test.sqlite';
const N_ENTITIES = 100000;
const N_KEYS = 200;
const PG_BATCH_SIZE = 2000;
const PG_CONCURRENCY = 8;

const TYPES = ['jira_ticket', 'github_pr', 'incident'];

// Fields cycle string/number/date — enough variety to exercise every
// filter/aggregation code path without per-key special-casing.
const FIELD_TYPES = ['string', 'number', 'date'] as const;
const KEY_DEFS: Array<{ key: string; type: (typeof FIELD_TYPES)[number] }> = Array.from(
  { length: N_KEYS },
  (_, i) => {
    const type = FIELD_TYPES[i % FIELD_TYPES.length];
    return { key: `${type}_field_${i}`, type };
  }
);

function randDateIso(daysBack: number): string {
  const t = Date.now() - Math.floor(Math.random() * daysBack * 86400000);
  return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
}

function randValue(id: number, type: (typeof FIELD_TYPES)[number]): string | null {
  if (type === 'number') return String(Math.floor(Math.random() * 100000));
  if (type === 'date') return Math.random() < 0.1 ? null : randDateIso(400);
  return `val-${id % 500}`;
}

/** Bounds how many batch inserts run concurrently, without materializing all rows in memory. */
class ConcurrencyGate {
  private active = new Set<Promise<void>>();
  constructor(private limit: number) {}

  async run(fn: () => Promise<void>): Promise<void> {
    while (this.active.size >= this.limit) {
      await Promise.race(this.active);
    }
    const p = fn().finally(() => this.active.delete(p));
    this.active.add(p);
  }

  async drain(): Promise<void> {
    await Promise.all(this.active);
  }
}

function buildMultiInsert(
  table: string,
  columns: string[],
  rows: unknown[][]
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const valueGroups = rows.map(row => {
    const placeholders = row.map(v => {
      params.push(v);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueGroups.join(', ')}`,
    params,
  };
}

async function genSqlite(url: string): Promise<void> {
  const configured = parseSqliteUrl(url);
  const path = configured === ':memory:' ? DEFAULT_SQLITE_PATH : configured;

  await confirmDestructiveSeed(`sqlite file at ${path}`);

  for (const f of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }

  const db = new Database(path);
  db.query('PRAGMA journal_mode = WAL').run();
  db.exec(SOURCE_SCHEMA_DDL);

  const insertEntity = db.prepare('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)');
  const insertMeta = db.prepare(
    'INSERT INTO entity_metadata (entity_id, key, value, value_type) VALUES (?, ?, ?, ?)'
  );

  const insertAll = db.transaction(() => {
    for (let id = 1; id <= N_ENTITIES; id++) {
      insertEntity.run(id, `TH-${String(id).padStart(6, '0')}`, TYPES[id % TYPES.length]);
      for (const kd of KEY_DEFS) {
        insertMeta.run(id, kd.key, randValue(id, kd.type), kd.type);
      }
      if (id % 10000 === 0) console.log(`  ...${id}/${N_ENTITIES} entities`);
    }
  });

  console.log(`Generating ${N_ENTITIES} entities x ${N_KEYS} metadata keys into ${path}`);
  const t0 = performance.now();
  insertAll();
  console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const counts = db
    .query('SELECT (SELECT COUNT(*) FROM entities) e, (SELECT COUNT(*) FROM entity_metadata) m')
    .get();
  console.log('Row counts:', counts);
  db.close();
}

async function genPostgres(url: string, adapter: 'postgres' | 'redshift'): Promise<void> {
  await confirmDestructiveSeed(`${adapter} source database at ${maskConnectionTarget(url)}`);

  const pool = new Pool({ connectionString: url });
  await pool.query(POSTGRES_SOURCE_SCHEMA_DDL);
  await pool.query('TRUNCATE entities, entity_metadata RESTART IDENTITY CASCADE');

  console.log(`Generating ${N_ENTITIES} entities x ${N_KEYS} metadata keys into ${adapter}`);
  const t0 = performance.now();

  const entityGate = new ConcurrencyGate(PG_CONCURRENCY);
  let entityBatch: unknown[][] = [];
  const flushEntities = async (batch: unknown[][]): Promise<void> => {
    const { sql, params } = buildMultiInsert('entities', ['id', 'name', 'type'], batch);
    await pool.query(sql, params);
  };
  for (let id = 1; id <= N_ENTITIES; id++) {
    entityBatch.push([id, `TH-${String(id).padStart(6, '0')}`, TYPES[id % TYPES.length]]);
    if (entityBatch.length >= PG_BATCH_SIZE) {
      const batch = entityBatch;
      entityBatch = [];
      await entityGate.run(() => flushEntities(batch));
    }
    if (id % 10000 === 0) console.log(`  ...${id}/${N_ENTITIES} entities queued`);
  }
  if (entityBatch.length > 0) await entityGate.run(() => flushEntities(entityBatch));
  await entityGate.drain();
  console.log(`Entities done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const metaGate = new ConcurrencyGate(PG_CONCURRENCY);
  let metaBatch: unknown[][] = [];
  const flushMeta = async (batch: unknown[][]): Promise<void> => {
    const { sql, params } = buildMultiInsert(
      'entity_metadata',
      ['entity_id', 'key', 'value', 'value_type'],
      batch
    );
    await pool.query(sql, params);
  };
  let metaQueued = 0;
  for (let id = 1; id <= N_ENTITIES; id++) {
    for (const kd of KEY_DEFS) {
      metaBatch.push([id, kd.key, randValue(id, kd.type), kd.type]);
      if (metaBatch.length >= PG_BATCH_SIZE) {
        const batch = metaBatch;
        metaBatch = [];
        await metaGate.run(() => flushMeta(batch));
      }
    }
    metaQueued += KEY_DEFS.length;
    if (id % 10000 === 0) console.log(`  ...${metaQueued} metadata rows queued`);
  }
  if (metaBatch.length > 0) await metaGate.run(() => flushMeta(metaBatch));
  await metaGate.drain();
  console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const { rows } = await pool.query(
    'SELECT (SELECT COUNT(*) FROM entities) e, (SELECT COUNT(*) FROM entity_metadata) m'
  );
  console.log('Row counts:', rows[0]);
  await pool.end();
}

async function main(): Promise<void> {
  const { sourceDb } = loadConfig();

  switch (sourceDb.adapter) {
    case 'sqlite':
      await genSqlite(sourceDb.url);
      break;
    case 'postgres':
    case 'redshift':
      await genPostgres(sourceDb.url, sourceDb.adapter);
      break;
    default: {
      const _exhaustive: never = sourceDb.adapter;
      throw new Error(`Unknown source adapter: ${_exhaustive}`);
    }
  }
}

main();
