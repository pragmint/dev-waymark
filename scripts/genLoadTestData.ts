/**
 * Generates a source-schema SQLite file with synthetic entities + metadata,
 * for exercising the app at data volumes larger than the golden seed.
 *
 * Usage: bun scripts/genLoadTestData.ts
 */

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync } from 'node:fs';
import { SOURCE_SCHEMA_DDL } from '../src/db/source/schema';

const DB_PATH = './big-test.sqlite';
const N_ENTITIES = 50000;
const N_KEYS = 60;

const TYPES = ['jira_ticket', 'github_pr', 'incident'];

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

const db = new Database(DB_PATH);
db.query('PRAGMA journal_mode = WAL').run();
db.exec(SOURCE_SCHEMA_DDL);

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

console.log(`Generating ${N_ENTITIES} entities x ${N_KEYS} metadata keys into ${DB_PATH}`);
const t0 = performance.now();
insertAll();
console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const counts = db
  .query('SELECT (SELECT COUNT(*) FROM entities) e, (SELECT COUNT(*) FROM entity_metadata) m')
  .get();
console.log('Row counts:', counts);
db.close();
