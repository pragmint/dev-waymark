import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// A tiny pipeline run laid out as pipeline/README.md describes, for tests:
//
//   lead_time ─┬─ tickets ── raw.jira_issues
//              └─ changes ── raw.github_pulls
//   entities ── tickets | changes
//
// One dlt id holds `+` and `/`, as real ones can, so URL encoding is exercised.

export const LINEAGE_FIXTURE = {
  leadTimeId: '9001',
  ticketIds: ['101', '102'],
  changeId: '201',
  jiraDltIds: ['jira/a+1', 'jira-b'],
  jiraKeys: ['DEMO-1', 'DEMO-2'],
  pullDltId: 'pull-1',
} as const;

const SOURCES = `STRUCT("table" VARCHAR, row_id VARCHAR)[]`;

// Each derived table's column map, written into its Parquet metadata as runner.py does.
const COLUMN_MAPS: Record<string, unknown> = {
  tickets: {
    ticket_key: ['raw.jira_issues.key'],
    issue_type: ['raw.jira_issues.fields:$.issuetype.name'],
  },
  changes: { repo: [], number: ['raw.github_pulls.number'] },
  lead_time_by_issue_type: {
    issue_type: ['tickets.issue_type'],
    tickets: ['tickets._row_id'],
    avg_lead_time_hours: ['changes.number'],
  },
  entities: {
    id: ['tickets._row_id', 'changes._row_id'],
    type: [],
    created_at: [],
    name: { by: 'type', when: { ticket: ['tickets.ticket_key'], change: ['changes.repo'] } },
  },
  entity_metadata: {
    id: [],
    entity_id: ['tickets._row_id'],
    key: [],
    value_type: [],
    created_at: [],
    updated_at: [],
    value: { by: 'key', when: { issue_type: ['tickets.issue_type'] } },
  },
};

function parquetOptions(run: string, table: string): string {
  const map = JSON.stringify(COLUMN_MAPS[table]).replace(/'/g, "''");
  return `TO '${run}/tables/${table}.parquet' (FORMAT parquet, KV_METADATA {waymark_columns: '${map}'})`;
}

const fixtureStatements = (run: string): string[] => [
  `COPY (SELECT * FROM (VALUES
     ('{"summary": "Fix the thing", "issuetype": {"name": "Task"}}', '1', 'DEMO-1', 'load-1', 'jira/a+1'),
     ('{"summary": "Add the other", "issuetype": {"name": "Task"}}', '2', 'DEMO-2', 'load-1', 'jira-b')
   ) AS t(fields, id, key, _dlt_load_id, _dlt_id))
   TO '${run}/raw/jira_issues/1.parquet' (FORMAT parquet)`,
  `COPY (SELECT 'demo/repo' AS repo, 7 AS number, 'DEMO-1 fix' AS title,
     'load-1' AS _dlt_load_id, 'pull-1' AS _dlt_id)
   TO '${run}/raw/github_pulls/1.parquet' (FORMAT parquet)`,
  // dlt bookkeeping, which must not become a table.
  `COPY (SELECT 'load-1' AS load_id) TO '${run}/raw/_dlt_loads/1.parquet' (FORMAT parquet)`,
  `COPY (SELECT * FROM (VALUES
     (101::BIGINT, [{'table': 'raw.jira_issues', 'row_id': 'jira/a+1'}]::${SOURCES}, 'DEMO-1', 'Task'),
     (102::BIGINT, [{'table': 'raw.jira_issues', 'row_id': 'jira-b'}]::${SOURCES}, 'DEMO-2', 'Task')
   ) AS t(_row_id, _sources, ticket_key, issue_type))
   ${parquetOptions(run, 'tickets')}`,
  `COPY (SELECT 201::BIGINT AS _row_id,
     [{'table': 'raw.github_pulls', 'row_id': 'pull-1'}]::${SOURCES} AS _sources,
     'demo/repo' AS repo, 7 AS number)
   ${parquetOptions(run, 'changes')}`,
  `COPY (SELECT 9001::BIGINT AS _row_id,
     [{'table': 'tickets', 'row_id': '101'}, {'table': 'tickets', 'row_id': '102'},
      {'table': 'changes', 'row_id': '201'}]::${SOURCES} AS _sources,
     'Task' AS issue_type, 2 AS tickets, 12.5 AS avg_lead_time_hours)
   ${parquetOptions(run, 'lead_time_by_issue_type')}`,
  `COPY (SELECT * FROM (VALUES
     (101::BIGINT, [{'table': 'tickets', 'row_id': '101'}]::${SOURCES}, 101::BIGINT, 'DEMO-1', 'ticket', '2026-01-01T00:00:00Z'),
     (102::BIGINT, [{'table': 'tickets', 'row_id': '102'}]::${SOURCES}, 102::BIGINT, 'DEMO-2', 'ticket', '2026-01-02T00:00:00Z'),
     (201::BIGINT, [{'table': 'changes', 'row_id': '201'}]::${SOURCES}, 201::BIGINT, 'demo/repo#7', 'change', '2026-01-03T00:00:00Z')
   ) AS t(_row_id, _sources, id, name, type, created_at))
   ${parquetOptions(run, 'entities')}`,
  `COPY (SELECT 1::BIGINT AS _row_id,
     [{'table': 'tickets', 'row_id': '101'}]::${SOURCES} AS _sources,
     1::BIGINT AS id, 101::BIGINT AS entity_id, 'issue_type' AS key, 'Task' AS value,
     'string' AS value_type, '2026-01-01T00:00:00Z' AS created_at,
     '2026-01-01T00:00:00Z' AS updated_at)
   ${parquetOptions(run, 'entity_metadata')}`,
];

/** Write the fixture run under `root`; returns its `tables/` folder, the adapter URL. */
export async function writeLineageFixture(root: string): Promise<string> {
  for (const dir of ['raw/jira_issues', 'raw/github_pulls', 'raw/_dlt_loads', 'tables']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    for (const sql of fixtureStatements(root)) await connection.run(sql);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  return join(root, 'tables');
}
