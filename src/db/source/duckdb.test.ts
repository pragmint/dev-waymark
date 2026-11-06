import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityRepository } from '../entityRepository';
import { emptyTree, makeGroup, makeLeaf, makeNot } from '../../schemas/filterTree';
import type { FilterTree } from '../../schemas/filterTree';
import { DuckdbSourceAdapter, parseParquetLocation } from './duckdb';
import { seedE2EData } from './e2eSeed';
import { SqliteSourceAdapter } from './sqlite';

const COLUMNS: Record<string, string> = {
  entities: `{'id': 'BIGINT', 'name': 'VARCHAR', 'type': 'VARCHAR', 'created_at': 'VARCHAR'}`,
  entity_metadata: `{'id': 'BIGINT', 'entity_id': 'BIGINT', 'key': 'VARCHAR', 'value': 'VARCHAR', 'value_type': 'VARCHAR', 'created_at': 'VARCHAR', 'updated_at': 'VARCHAR'}`,
};

async function exportToParquet(sqlite: SqliteSourceAdapter, dir: string): Promise<void> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  for (const table of Object.keys(COLUMNS)) {
    const rows = await sqlite.query(`SELECT * FROM ${table}`);
    const jsonPath = join(dir, `${table}.json`);
    writeFileSync(jsonPath, JSON.stringify(rows));
    await connection.run(
      `COPY (SELECT * FROM read_json('${jsonPath}', format = 'array', columns = ${COLUMNS[table]}))
       TO '${join(dir, table)}.parquet' (FORMAT parquet)`
    );
  }
  connection.closeSync();
  instance.closeSync();
}

describe('DuckdbSourceAdapter', () => {
  let dir: string;
  let sqlite: SqliteSourceAdapter;
  let duckdb: DuckdbSourceAdapter;
  let expected: ReturnType<typeof createEntityRepository>;
  let actual: ReturnType<typeof createEntityRepository>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'waymark-duckdb-'));
    sqlite = new SqliteSourceAdapter(':memory:', true);
    await seedE2EData(sqlite);
    await exportToParquet(sqlite, dir);
    duckdb = await DuckdbSourceAdapter.create(`file://${dir}/`);
    expected = createEntityRepository(sqlite);
    actual = createEntityRepository(duckdb);
  });

  afterAll(async () => {
    await duckdb.close();
    await sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const trees: Record<string, FilterTree> = {
    'no filter': emptyTree(),
    'entity type': makeGroup('AND', [makeLeaf('entity_type', 'eq', 'jira_ticket')]),
    'entity name contains': makeGroup('AND', [makeLeaf('entity_name', 'contains', 'TH-00')]),
    'numeric comparison on a mixed population': makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'jira_ticket'),
      makeLeaf('status', 'gte', '1'),
    ]),
    'negated group': makeNot(makeGroup('AND', [makeLeaf('entity_type', 'eq', 'github_pr')])),
    'OR group': makeGroup('OR', [
      makeLeaf('entity_type', 'eq', 'github_pr'),
      makeLeaf('entity_name', 'contains', 'TH-0001'),
    ]),
  };

  for (const [name, tree] of Object.entries(trees)) {
    it(`matches SQLite for list: ${name}`, async () => {
      expect(await actual.list(tree)).toEqual(await expected.list(tree));
    });

    it(`matches SQLite for count: ${name}`, async () => {
      expect(await actual.count(tree)).toBe(await expected.count(tree));
    });

    it(`matches SQLite for available filters: ${name}`, async () => {
      expect(await actual.getAvailableFilters(tree)).toEqual(
        await expected.getAvailableFilters(tree)
      );
    });
  }

  it('matches SQLite for a numeric filter on every metadata key', async () => {
    const rows = await sqlite.query<{ key: string }>('SELECT DISTINCT key FROM entity_metadata');
    for (const { key } of rows) {
      const tree = makeGroup('AND', [makeLeaf(key, 'gte', '5')]);
      expect(await actual.count(tree)).toBe(await expected.count(tree));
    }
  });

  it('matches SQLite for list with keys, limit and cursor', async () => {
    const opts = { keys: ['status'], limit: 3, afterId: 20 };
    expect(await actual.list(emptyTree(), opts)).toEqual(await expected.list(emptyTree(), opts));
  });

  it('matches SQLite for paging, lookups and listings', async () => {
    const page = { limit: 5, offset: 5 };
    expect(await actual.listPaged(emptyTree(), page)).toEqual(
      await expected.listPaged(emptyTree(), page)
    );
    expect(await actual.get(1)).toEqual(await expected.get(1));
    expect(await actual.get(999999)).toBeNull();
    expect(await actual.listEntityTypes()).toEqual(await expected.listEntityTypes());
    expect(await actual.listMetadataKeys('jira_ticket')).toEqual(
      await expected.listMetadataKeys('jira_ticket')
    );
  });

  it('handles an id list too long for per-id placeholders', async () => {
    const ids = Array.from({ length: 70000 }, (_, i) => i + 1);
    const { sql, params } = duckdb.inList('id', ids);
    const rows = await duckdb.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM entities WHERE ${sql}`,
      params
    );
    const all = await duckdb.query<{ total: number }>('SELECT COUNT(*) AS total FROM entities');
    expect(rows[0]?.total).toBe(all[0]?.total);
  });

  it('runs concurrent queries', async () => {
    const counts = await Promise.all(Array.from({ length: 8 }, () => actual.count(emptyTree())));
    expect(new Set(counts).size).toBe(1);
  });

  it('rejects writes', async () => {
    await expect(duckdb.execute()).rejects.toThrow('read-only');
  });

  it('fails at startup when the Parquet files are missing', async () => {
    await expect(DuckdbSourceAdapter.create(join(dir, 'missing'))).rejects.toThrow();
  });
});

describe('parseParquetLocation', () => {
  it('strips the file scheme and trailing slashes', () => {
    expect(parseParquetLocation('file:///data/run/')).toBe('/data/run');
  });

  it('leaves bucket URLs alone', () => {
    expect(parseParquetLocation('s3://bucket/run')).toBe('s3://bucket/run');
  });
});
