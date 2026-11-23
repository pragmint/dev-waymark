import { describe, expect, it } from 'bun:test';
import type { ColumnMap } from '../schemas/lineage';
import type { FieldFetchers } from './columnLineage';
import {
  directColumns,
  parseColumnRef,
  refLabel,
  refText,
  traceEntityValue,
  traceField,
  walkField,
} from './columnLineage';

// Column maps shaped like the Kafka jobs: each is the union of its table's rows' `_fields`.
// Tickets and pull requests share `entities`, so its created_at reads either raw created field.
// A ticket's issue_type and a change's merged_at are metadata: `entities.<key>` names them, and
// the metadata row that holds each says what it reads.
const MAPS: Record<string, ColumnMap> = {
  lead_time: {
    issue_type: ['entities[type=ticket].issue_type'],
    avg_hours: [
      'entities[type=change].created_at',
      'entities[type=change].merged_at',
      'links._row_id',
    ],
    any_created: ['entities.created_at'],
  },
  entities: {
    type: [],
    created_at: ['raw.github_pulls.created_at', 'raw.jira_issues.fields:$.created'],
  },
  entity_metadata: {
    value: ['raw.github_pulls.merged_at', 'raw.jira_issues.fields:$.issuetype.name'],
  },
  links: {
    ticket_id: ['entities._row_id'],
    change_id: ['entities._row_id'],
  },
};

// lead_time 1 summarizes ticket t1, its change c1 and the link l1 between them.
const SOURCES: Record<string, Record<string, Array<{ table: string; row_id: string }>>> = {
  lead_time: {
    '1': [
      { table: 'entities', row_id: 't1' },
      { table: 'entities', row_id: 'c1' },
      { table: 'links', row_id: 'l1' },
    ],
  },
  entities: {
    t1: [{ table: 'raw.jira_issues', row_id: 'j1' }],
    c1: [{ table: 'raw.github_pulls', row_id: 'p1' }],
  },
  entity_metadata: {
    't1:issue_type': [{ table: 'raw.jira_issues', row_id: 'j1' }],
    'c1:merged_at': [{ table: 'raw.github_pulls', row_id: 'p1' }],
  },
  links: {
    l1: [
      { table: 'entities', row_id: 't1' },
      { table: 'entities', row_id: 'c1' },
    ],
  },
};
const TYPES: Record<string, string> = { t1: 'ticket', c1: 'change' };
// Rows' own `_fields`; every other row falls back to its table's map. Each metadata row's says
// exactly what its one value reads.
const FIELDS: Record<string, Record<string, ColumnMap>> = {
  entity_metadata: {
    't1:issue_type': { value: ['raw.jira_issues.fields:$.issuetype.name'] },
    'c1:merged_at': { value: ['raw.github_pulls.merged_at'] },
  },
};

const FETCHERS: FieldFetchers = {
  async rowSources(table, rowIds) {
    return rowIds.flatMap(rowId =>
      (SOURCES[table]?.[rowId] ?? []).map(source => ({ rowId, ...source }))
    );
  },
  async rowFields(table, rowIds) {
    return Object.fromEntries(
      rowIds.flatMap(rowId => (FIELDS[table]?.[rowId] ? [[rowId, FIELDS[table][rowId]]] : []))
    );
  },
  async columnValues(table, column, rowIds) {
    expect([table, column]).toEqual(['entities', 'type']);
    return Object.fromEntries(rowIds.map(id => [id, TYPES[id] ?? null]));
  },
  // A metadata row's id here is `<entity>:<key>`.
  async metadataRows(entityIds, keys) {
    return entityIds.flatMap(entityId =>
      keys
        .map(key => ({ entityId, key, rowId: `${entityId}:${key}` }))
        .filter(({ rowId }) => rowId in (SOURCES.entity_metadata ?? {}))
    );
  },
};

async function walk(field: string, values: Record<string, unknown> = {}, depth?: number) {
  const trace = traceField(MAPS, 'lead_time', field, values);
  if (!trace) throw new Error('expected a trace');
  return walkField('lead_time', '1', trace, MAPS, FETCHERS, { depth });
}

describe('parseColumnRef / refLabel / refText', () => {
  it('parses table, column and JSON path', () => {
    expect(parseColumnRef('changes.merged_at')).toEqual({ table: 'changes', column: 'merged_at' });
    const ref = parseColumnRef('raw.jira_issues.fields:$.priority.name');
    expect(ref).toEqual({ table: 'raw.jira_issues', column: 'fields', path: '$.priority.name' });
    expect(ref && refLabel(ref)).toBe('fields:$.priority.name');
  });

  it('parses a row filter', () => {
    const ref = parseColumnRef('entities[type=change].created_at');
    expect(ref).toEqual({
      table: 'entities',
      column: 'created_at',
      where: { column: 'type', value: 'change' },
    });
    expect(ref && refLabel(ref)).toBe('created_at');
    expect(ref && refText(ref)).toBe('entities[type=change].created_at');
    expect(parseColumnRef('entities[issue_type=New Feature]._row_id')?.where?.value).toBe(
      'New Feature'
    );
  });

  it('rejects malformed references', () => {
    expect(parseColumnRef('merged_at')).toBeNull();
    expect(parseColumnRef('raw.x.fields:priority')).toBeNull();
    expect(parseColumnRef('entities[type].x')).toBeNull();
    expect(parseColumnRef('entities[type=].x')).toBeNull();
  });
});

describe('traceField', () => {
  it('starts from the table’s map without _fields', () => {
    expect(traceField(MAPS, 'lead_time', 'issue_type', {})?.direct).toEqual([
      { table: 'entities', column: 'issue_type', where: { column: 'type', value: 'ticket' } },
    ]);
  });

  it('starts from the row’s own _fields', () => {
    const values = { _fields: { avg_hours: ['links._row_id'] } };
    expect(traceField(MAPS, 'lead_time', 'avg_hours', values)?.direct).toEqual([
      { table: 'links', column: '_row_id' },
    ]);
  });

  it('ignores _fields that are not a column map', () => {
    expect(traceField(MAPS, 'lead_time', 'any_created', { _fields: 'nope' })?.direct).toEqual([
      { table: 'entities', column: 'created_at' },
    ]);
  });

  it('marks a constant column as reading nothing', () => {
    expect(traceField(MAPS, 'entities', 'type', {})?.direct).toEqual([]);
  });

  it('returns null without a column map or an undeclared field', () => {
    expect(traceField(MAPS, 'unknown', 'x', {})).toBeNull();
    expect(traceField(MAPS, 'lead_time', 'nope', {})).toBeNull();
  });

  it('lists direct references by table', () => {
    const trace = traceField(MAPS, 'lead_time', 'avg_hours', {});
    expect(trace && directColumns(trace)).toEqual({
      entities: ['created_at', 'merged_at'],
      links: ['_row_id'],
    });
  });
});

describe('traceEntityValue', () => {
  it('starts an entity’s metadata value from the metadata row that holds it', async () => {
    const trace = await traceEntityValue('c1', 'merged_at', FETCHERS);
    expect(trace?.direct).toEqual([{ table: 'raw.github_pulls', column: 'merged_at' }]);
    const walked = trace && (await walkField('entities', 'c1', trace, MAPS, FETCHERS));
    expect(walked?.hops).toEqual([{ entities: ['c1'] }, { 'raw.github_pulls': ['p1'] }]);
    expect(walked?.columns).toEqual({ 'raw.github_pulls': ['merged_at'] });
  });

  it('returns null for a key the entity has no value for, or one of its own columns', async () => {
    expect(await traceEntityValue('t1', 'merged_at', FETCHERS)).toBeNull();
    expect(await traceEntityValue('t1', 'name', FETCHERS)).toBeNull();
  });
});

describe('walkField', () => {
  it('follows a filtered reference to the rows it matches only', async () => {
    const { hops } = await walk('avg_hours');
    expect(hops[1]).toEqual({ entities: ['c1'], links: ['l1'] });
  });

  it('names only the raw fields of the rows a field reads', async () => {
    // The ticket is reached through the link, as a whole row, but its created field isn't read.
    const { columns, leaves } = await walk('avg_hours');
    expect(columns).toEqual({
      entities: ['created_at', 'merged_at'],
      links: ['_row_id'],
      'raw.github_pulls': ['created_at', 'merged_at'],
    });
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'], 'raw.jira_issues': ['j1'] });
  });

  it('follows a row again only for what it needs beyond what was followed', async () => {
    // c1 is followed for two columns at hop 1, then whole through the link at hop 2.
    const { hops } = await walk('avg_hours');
    expect(hops.slice(2)).toEqual([
      { entities: ['c1', 't1'], 'raw.github_pulls': ['p1'] },
      { 'raw.github_pulls': ['p1'], 'raw.jira_issues': ['j1'] },
    ]);
  });

  it('reaches only the ticket’s raw row for a ticket field', async () => {
    const { columns, leaves } = await walk('issue_type');
    expect(columns).toEqual({
      entities: ['issue_type'],
      'raw.jira_issues': ['fields:$.issuetype.name'],
    });
    expect(leaves).toEqual({ 'raw.jira_issues': ['j1'] });
  });

  it('reads each row’s own sources, so an unfiltered column still names only what is reached', async () => {
    const { columns, leaves } = await walk('any_created');
    expect(columns['raw.github_pulls']).toEqual(['created_at']);
    expect(columns['raw.jira_issues']).toEqual(['fields:$.created']);
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'], 'raw.jira_issues': ['j1'] });
  });

  it('stops after the hops it is asked for', async () => {
    const { hops, leaves } = await walk('avg_hours', {}, 1);
    expect(hops).toHaveLength(2);
    expect(leaves).toEqual({});
  });

  it('never shows a metadata row: a value is reached through its entity', async () => {
    const { hops, columns } = await walk('issue_type');
    expect(hops).toEqual([
      { lead_time: ['1'] },
      { entities: ['t1'] },
      { 'raw.jira_issues': ['j1'] },
    ]);
    expect(Object.keys(columns)).not.toContain('entity_metadata');
  });

  it('follows nothing for a key an entity has no value for', async () => {
    // t1 has no merged_at, so a reference that reached it for one would read nothing there.
    const values = { _fields: { avg_hours: ['entities.merged_at'] } };
    const { leaves } = await walk('avg_hours', values);
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'] });
  });

  it('follows every source of a column nothing maps', async () => {
    const values = { _fields: { avg_hours: ['links.unmapped'] } };
    const { leaves } = await walk('avg_hours', values);
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'], 'raw.jira_issues': ['j1'] });
  });
});
