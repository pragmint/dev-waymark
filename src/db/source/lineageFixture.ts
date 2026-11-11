import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A tiny published pipeline snapshot, laid out as pipeline/snapshot.py describes, for tests:
//
//   lead_time ─┬─ tickets ── raw.jira_issues
//              └─ changes ── raw.github_pulls
//   entities ── tickets | changes
//
// One dlt id holds `+` and `/`, as real ones can, so URL encoding is exercised. An older run's
// raw files and an older snapshot's tables sit beside it, as they would in a bucket; only what the
// manifest lists may be read.

export const LINEAGE_FIXTURE = {
  snapshotId: 's2',
  staleTicketKey: 'STALE-1',
  leadTimeId: '9001',
  ticketIds: ['101', '102'],
  changeId: '201',
  jiraDltIds: ['jira/a+1', 'jira-b'],
  jiraKeys: ['DEMO-1', 'DEMO-2'],
  pullDltId: 'pull-1',
} as const;

const SOURCES = `STRUCT("table" VARCHAR, row_id VARCHAR)[]`;

type Fields = Record<string, string[]>;

// Each derived row's `_fields`, by table; entities' differ by row, as the real job's do.
const TICKET_FIELDS: Fields = {
  ticket_key: ['raw.jira_issues.key'],
  issue_type: ['raw.jira_issues.fields:$.issuetype.name'],
};
const CHANGE_FIELDS: Fields = { repo: [], number: ['raw.github_pulls.number'] };
const LEAD_TIME_FIELDS: Fields = {
  issue_type: ['tickets.issue_type'],
  tickets: ['tickets._row_id'],
  avg_lead_time_hours: ['changes.number'],
};
const entityFields = (table: string, name: string): Fields => ({
  id: [`${table}._row_id`],
  name: [name],
  type: [],
  created_at: [],
});
const METADATA_FIELDS: Fields = {
  id: [],
  entity_id: ['tickets._row_id'],
  key: [],
  value: ['tickets.issue_type'],
  value_type: [],
  created_at: [],
  updated_at: [],
};

// Each table's column map, the union of its rows' `_fields`, written into its Parquet metadata
// as runner.py does.
const COLUMN_MAPS: Record<string, Fields> = {
  tickets: TICKET_FIELDS,
  changes: CHANGE_FIELDS,
  lead_time_by_issue_type: LEAD_TIME_FIELDS,
  entities: {
    ...entityFields('tickets', 'tickets.ticket_key'),
    id: ['changes._row_id', 'tickets._row_id'],
    name: ['changes.repo', 'tickets.ticket_key'],
  },
  entity_metadata: METADATA_FIELDS,
};

/** A `_fields` map literal. */
function fieldsSql(fields: Fields): string {
  const entries = Object.entries(fields).map(
    ([column, refs]) => `'${column}': [${refs.map(ref => `'${ref}'`).join(', ')}]::VARCHAR[]`
  );
  return `MAP {${entries.join(', ')}}`;
}

const RUN = 'r2';
const SNAPSHOT = 's2';
const RAW_TABLES = ['jira_issues', 'github_pulls'];
const TABLES = ['tickets', 'changes', 'lead_time_by_issue_type', 'entities', 'entity_metadata'];

const rawKey = (table: string, run = RUN): string => `raw/${table}/${run}.1.0.parquet`;
const tableKey = (table: string, snapshot = SNAPSHOT): string =>
  `tables/${table}/${snapshot}.parquet`;

function parquetOptions(run: string, table: string): string {
  const map = JSON.stringify(COLUMN_MAPS[table]).replace(/'/g, "''");
  return `TO '${run}/${tableKey(table)}' (FORMAT parquet, KV_METADATA {waymark_columns: '${map}'})`;
}

const fixtureStatements = (run: string): string[] => [
  `COPY (SELECT * FROM (VALUES
     ('{"summary": "Fix the thing", "issuetype": {"name": "Task"}}', '1', 'DEMO-1', 'load-1', 'jira/a+1'),
     ('{"summary": "Add the other", "issuetype": {"name": "Task"}}', '2', 'DEMO-2', 'load-1', 'jira-b')
   ) AS t(fields, id, key, _dlt_load_id, _dlt_id))
   TO '${run}/${rawKey('jira_issues')}' (FORMAT parquet)`,
  `COPY (SELECT 'demo/repo' AS repo, 7 AS number, 'DEMO-1 fix' AS title,
     'load-1' AS _dlt_load_id, 'pull-1' AS _dlt_id)
   TO '${run}/${rawKey('github_pulls')}' (FORMAT parquet)`,
  // dlt bookkeeping, which must not become a table.
  `COPY (SELECT 'load-1' AS load_id) TO '${run}/${rawKey('_dlt_loads')}' (FORMAT parquet)`,
  // Decoys: an older run's version of a raw row, and an older snapshot's tickets.
  `COPY (SELECT '{"summary": "Stale"}' AS fields, '1' AS id, '${LINEAGE_FIXTURE.staleTicketKey}' AS key,
     'load-0' AS _dlt_load_id, 'jira/a+1' AS _dlt_id)
   TO '${run}/${rawKey('jira_issues', 'r1')}' (FORMAT parquet)`,
  `COPY (SELECT 101::BIGINT AS _row_id, '${LINEAGE_FIXTURE.staleTicketKey}' AS ticket_key)
   TO '${run}/${tableKey('tickets', 's1')}' (FORMAT parquet)`,
  `COPY (SELECT * FROM (VALUES
     (101::BIGINT, [{'table': 'raw.jira_issues', 'row_id': 'jira/a+1'}]::${SOURCES}, ${fieldsSql(TICKET_FIELDS)}, 'DEMO-1', 'Task'),
     (102::BIGINT, [{'table': 'raw.jira_issues', 'row_id': 'jira-b'}]::${SOURCES}, ${fieldsSql(TICKET_FIELDS)}, 'DEMO-2', 'Task')
   ) AS t(_row_id, _sources, _fields, ticket_key, issue_type))
   ${parquetOptions(run, 'tickets')}`,
  `COPY (SELECT 201::BIGINT AS _row_id,
     [{'table': 'raw.github_pulls', 'row_id': 'pull-1'}]::${SOURCES} AS _sources,
     ${fieldsSql(CHANGE_FIELDS)} AS _fields,
     'demo/repo' AS repo, 7 AS number)
   ${parquetOptions(run, 'changes')}`,
  `COPY (SELECT 9001::BIGINT AS _row_id,
     [{'table': 'tickets', 'row_id': '101'}, {'table': 'tickets', 'row_id': '102'},
      {'table': 'changes', 'row_id': '201'}]::${SOURCES} AS _sources,
     ${fieldsSql(LEAD_TIME_FIELDS)} AS _fields,
     'Task' AS issue_type, 2 AS tickets, 12.5 AS avg_lead_time_hours)
   ${parquetOptions(run, 'lead_time_by_issue_type')}`,
  `COPY (SELECT * FROM (VALUES
     (101::BIGINT, [{'table': 'tickets', 'row_id': '101'}]::${SOURCES}, ${fieldsSql(entityFields('tickets', 'tickets.ticket_key'))}, 101::BIGINT, 'DEMO-1', 'ticket', '2026-01-01T00:00:00Z'),
     (102::BIGINT, [{'table': 'tickets', 'row_id': '102'}]::${SOURCES}, ${fieldsSql(entityFields('tickets', 'tickets.ticket_key'))}, 102::BIGINT, 'DEMO-2', 'ticket', '2026-01-02T00:00:00Z'),
     (201::BIGINT, [{'table': 'changes', 'row_id': '201'}]::${SOURCES}, ${fieldsSql(entityFields('changes', 'changes.repo'))}, 201::BIGINT, 'demo/repo#7', 'change', '2026-01-03T00:00:00Z')
   ) AS t(_row_id, _sources, _fields, id, name, type, created_at))
   ${parquetOptions(run, 'entities')}`,
  `COPY (SELECT 1::BIGINT AS _row_id,
     [{'table': 'tickets', 'row_id': '101'}]::${SOURCES} AS _sources,
     ${fieldsSql(METADATA_FIELDS)} AS _fields,
     1::BIGINT AS id, 101::BIGINT AS entity_id, 'issue_type' AS key, 'Task' AS value,
     'string' AS value_type, '2026-01-01T00:00:00Z' AS created_at,
     '2026-01-01T00:00:00Z' AS updated_at)
   ${parquetOptions(run, 'entity_metadata')}`,
];

/** The manifest pipeline/snapshot.py would write for the fixture snapshot. */
function manifest(): object {
  const tables: Record<string, { files: string[] }> = {};
  for (const table of RAW_TABLES) tables[`raw.${table}`] = { files: [rawKey(table)] };
  for (const table of TABLES) tables[table] = { files: [tableKey(table)] };
  return { version: 1, snapshot: SNAPSHOT, extract: RUN, tables };
}

/** Write the fixture bucket under `root` and publish its snapshot; returns `root`, the adapter URL. */
export async function writeLineageFixture(root: string): Promise<string> {
  for (const dir of [...RAW_TABLES, '_dlt_loads'].map(t => `raw/${t}`)) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const table of TABLES) mkdirSync(join(root, 'tables', table), { recursive: true });
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
