import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A tiny published pipeline snapshot, laid out as pipeline/snapshot.py describes, for tests.
// Every job writes its part of the two entity tables; nothing else but raw data is a table:
//
//   tickets ── raw.jira_issues          entities 101, 102 and their metadata 1, 2
//   changes ── raw.github_pulls         entity 201 and its metadata 3
//   lead_time_by_issue_type ── entities 101, 102, 201  entity 9001 and its metadata 4, 5, 6
//
// The lead time reads the tickets' issue_type and the change's number, which are metadata, but
// cites the entities they belong to and names them `entities[type=ticket].issue_type` and
// `entities[type=change].number`.
//
// One dlt id holds `+` and `/`, as real ones can, so URL encoding is exercised. An older run's
// raw files and an older snapshot's parts sit beside it, as they would in a bucket; only what the
// manifest lists may be read.

export const LINEAGE_FIXTURE = {
  snapshotId: 's2',
  staleTicketKey: 'STALE-1',
  leadTimeId: '9001',
  ticketIds: ['101', '102'],
  changeId: '201',
  /** The tickets' issue_type metadata rows, which hold what the lead time's name reads. */
  issueTypeIds: ['1', '2'],
  /** The change's number metadata row, which holds what the lead time's average reads. */
  changeNumberId: '3',
  jiraDltIds: ['jira/a+1', 'jira-b'],
  jiraKeys: ['DEMO-1', 'DEMO-2'],
  pullDltId: 'pull-1',
} as const;

const SOURCES = `STRUCT("table" VARCHAR, row_id VARCHAR)[]`;
const RUN = 'r2';
const SNAPSHOT = 's2';
const RAW_TABLES = ['jira_issues', 'github_pulls'];
const ENTITY_TABLES = ['entities', 'entity_metadata'];
const JOBS = ['tickets', 'changes', 'lead_time_by_issue_type'];

type Fields = Record<string, string[]>;

/** A `_fields` map literal. */
function fieldsSql(fields: Fields): string {
  const entries = Object.entries(fields).map(
    ([column, refs]) => `'${column}': [${refs.map(ref => `'${ref}'`).join(', ')}]::VARCHAR[]`
  );
  return `MAP {${entries.join(', ')}}`;
}

function sourcesSql(sources: Array<[string, string]>): string {
  const entries = sources.map(([table, rowId]) => `{'table': '${table}', 'row_id': '${rowId}'}`);
  return `[${entries.join(', ')}]::${SOURCES}`;
}

const entityFields = (name: string[]): Fields => ({ id: [], name, type: [], created_at: [] });
const metadataFields = (value: string[]): Fields => ({
  id: [],
  entity_id: [],
  entity_type: [],
  key: [],
  value,
  value_type: [],
  created_at: [],
  updated_at: [],
});

type Entity = { id: number; sources: Array<[string, string]>; name: string; createdAt: string };
type Metadata = {
  id: number;
  entityId: number;
  sources: Array<[string, string]>;
  key: string;
  value: string;
  valueType: string;
  refs: string[];
};
type Part = { type: string; nameRefs: string[]; entities: Entity[]; metadata: Metadata[] };

const LEAD_TIME_SOURCES: Array<[string, string]> = [
  ['entities', '101'],
  ['entities', '102'],
  ['entities', '201'],
];

// Each job's part of the two entity tables, as runner.py writes them.
const PARTS: Record<string, Part> = {
  tickets: {
    type: 'ticket',
    nameRefs: ['raw.jira_issues.key'],
    entities: [
      {
        id: 101,
        sources: [['raw.jira_issues', 'jira/a+1']],
        name: 'DEMO-1',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 102,
        sources: [['raw.jira_issues', 'jira-b']],
        name: 'DEMO-2',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ],
    metadata: [1, 2].map(id => ({
      id,
      entityId: 100 + id,
      sources: [['raw.jira_issues', id === 1 ? 'jira/a+1' : 'jira-b']] as Array<[string, string]>,
      key: 'issue_type',
      value: 'Task',
      valueType: 'string',
      refs: ['raw.jira_issues.fields:$.issuetype.name'],
    })),
  },
  changes: {
    type: 'change',
    nameRefs: ['raw.github_pulls.number', 'raw.github_pulls.repo'],
    entities: [
      {
        id: 201,
        sources: [['raw.github_pulls', 'pull-1']],
        name: 'demo/repo#7',
        createdAt: '2026-01-03T00:00:00Z',
      },
    ],
    metadata: [
      {
        id: 3,
        entityId: 201,
        sources: [['raw.github_pulls', 'pull-1']],
        key: 'number',
        value: '7',
        valueType: 'number',
        refs: ['raw.github_pulls.number'],
      },
    ],
  },
  lead_time_by_issue_type: {
    type: 'lead_time_by_issue_type',
    nameRefs: ['entities[type=ticket].issue_type'],
    entities: [
      { id: 9001, sources: LEAD_TIME_SOURCES, name: 'Task', createdAt: '2026-01-03T00:00:00Z' },
    ],
    metadata: [
      ['issue_type', 'Task', 'string', ['entities[type=ticket].issue_type']],
      ['tickets', '2', 'number', ['entities[type=ticket]._row_id']],
      ['avg_lead_time_hours', '12.5', 'number', ['entities[type=change].number']],
    ].map(([key, value, valueType, refs], i) => ({
      id: 4 + i,
      entityId: 9001,
      sources: LEAD_TIME_SOURCES,
      key: key as string,
      value: value as string,
      valueType: valueType as string,
      refs: refs as string[],
    })),
  },
};

const rawKey = (table: string, run = RUN): string => `raw/${table}/${run}.1.0.parquet`;
const partKey = (table: string, job: string, snapshot = SNAPSHOT): string =>
  `tables/${table}/${snapshot}.${job}.parquet`;

/** The union of the rows' `_fields`, as runner.py writes into each part's Parquet metadata. */
function columnMap(rows: Fields[]): Fields {
  const map: Record<string, Set<string>> = {};
  for (const fields of rows) {
    for (const [column, refs] of Object.entries(fields)) {
      map[column] = new Set([...(map[column] ?? []), ...refs]);
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([column, refs]) => [column, [...refs].sort()])
  );
}

function copyTo(root: string, key: string, rows: Fields[]): string {
  const map = JSON.stringify(columnMap(rows)).replace(/'/g, "''");
  return `TO '${root}/${key}' (FORMAT parquet, KV_METADATA {waymark_columns: '${map}'})`;
}

function partStatements(root: string, job: string, part: Part): string[] {
  const entities = part.entities.map(
    e =>
      `(${e.id}::BIGINT, ${sourcesSql(e.sources)}, ${fieldsSql(entityFields(part.nameRefs))},` +
      ` ${e.id}::BIGINT, '${e.name}', '${part.type}', '${e.createdAt}')`
  );
  const metadata = part.metadata.map(m => {
    const createdAt = part.entities.find(e => e.id === m.entityId)?.createdAt ?? '';
    return (
      `(${m.id}::BIGINT, ${sourcesSql(m.sources)}, ${fieldsSql(metadataFields(m.refs))},` +
      ` ${m.id}::BIGINT, ${m.entityId}::BIGINT, '${part.type}', '${m.key}', '${m.value}',` +
      ` '${m.valueType}', '${createdAt}', '${createdAt}')`
    );
  });
  return [
    `COPY (SELECT * FROM (VALUES ${entities.join(', ')})
       AS t(_row_id, _sources, _fields, id, name, type, created_at))
     ${copyTo(
       root,
       partKey('entities', job),
       part.entities.map(() => entityFields(part.nameRefs))
     )}`,
    `COPY (SELECT * FROM (VALUES ${metadata.join(', ')})
       AS t(_row_id, _sources, _fields, id, entity_id, entity_type, key, value, value_type,
            created_at, updated_at))
     ${copyTo(
       root,
       partKey('entity_metadata', job),
       part.metadata.map(m => metadataFields(m.refs))
     )}`,
  ];
}

const fixtureStatements = (root: string): string[] => [
  `COPY (SELECT * FROM (VALUES
     ('{"summary": "Fix the thing", "issuetype": {"name": "Task"}}', '1', 'DEMO-1', 'load-1', 'jira/a+1'),
     ('{"summary": "Add the other", "issuetype": {"name": "Task"}}', '2', 'DEMO-2', 'load-1', 'jira-b')
   ) AS t(fields, id, key, _dlt_load_id, _dlt_id))
   TO '${root}/${rawKey('jira_issues')}' (FORMAT parquet)`,
  `COPY (SELECT 'demo/repo' AS repo, 7 AS number, 'DEMO-1 fix' AS title,
     'load-1' AS _dlt_load_id, 'pull-1' AS _dlt_id)
   TO '${root}/${rawKey('github_pulls')}' (FORMAT parquet)`,
  // dlt bookkeeping, which must not become a table.
  `COPY (SELECT 'load-1' AS load_id) TO '${root}/${rawKey('_dlt_loads')}' (FORMAT parquet)`,
  // Decoys: an older run's version of a raw row, and an older snapshot's tickets.
  `COPY (SELECT '{"summary": "Stale"}' AS fields, '1' AS id, '${LINEAGE_FIXTURE.staleTicketKey}' AS key,
     'load-0' AS _dlt_load_id, 'jira/a+1' AS _dlt_id)
   TO '${root}/${rawKey('jira_issues', 'r1')}' (FORMAT parquet)`,
  `COPY (SELECT 101::BIGINT AS _row_id, 101::BIGINT AS id,
     '${LINEAGE_FIXTURE.staleTicketKey}' AS name, 'ticket' AS type,
     '2025-01-01T00:00:00Z' AS created_at)
   TO '${root}/${partKey('entities', 'tickets', 's1')}' (FORMAT parquet)`,
  ...JOBS.flatMap(job => partStatements(root, job, PARTS[job] as Part)),
];

/** The manifest pipeline/snapshot.py would write for the fixture snapshot. */
function manifest(): object {
  const tables: Record<string, { files: string[]; parts?: Record<string, string> }> = {};
  for (const table of RAW_TABLES) tables[`raw.${table}`] = { files: [rawKey(table)] };
  for (const table of ENTITY_TABLES) {
    const parts = Object.fromEntries(JOBS.map(job => [job, partKey(table, job)]));
    tables[table] = { files: Object.values(parts), parts };
  }
  return { version: 2, snapshot: SNAPSHOT, extract: RUN, tables };
}

/** Write the fixture bucket under `root` and publish its snapshot; returns `root`, the adapter URL. */
export async function writeLineageFixture(root: string): Promise<string> {
  for (const dir of [...RAW_TABLES, '_dlt_loads'].map(t => `raw/${t}`)) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const table of ENTITY_TABLES) mkdirSync(join(root, 'tables', table), { recursive: true });
  mkdirSync(join(root, 'snapshots'), { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    for (const sql of fixtureStatements(root)) await connection.run(sql);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  writeFileSync(join(root, 'snapshots', `${SNAPSHOT}.json`), JSON.stringify(manifest()));
  writeFileSync(
    join(root, 'latest.json'),
    JSON.stringify({ snapshot: SNAPSHOT, manifest: `snapshots/${SNAPSHOT}.json` })
  );
  return root;
}
