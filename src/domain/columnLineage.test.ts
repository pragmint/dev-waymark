import { describe, expect, it } from 'bun:test';
import type { ColumnMap } from '../schemas/lineage';
import {
  directColumns,
  followFor,
  parseColumnRef,
  refLabel,
  refsFor,
  traceField,
} from './columnLineage';
import { expandToRaw } from './lineage';
import type { FetchSources } from './lineage';

// Column maps shaped like the Kafka jobs.
const MAPS: Record<string, ColumnMap> = {
  lead_time: {
    issue_type: ['tickets.issue_type'],
    tickets: ['tickets._row_id'],
    avg_hours: ['changes.created_at', 'changes.merged_at'],
  },
  tickets: {
    issue_type: ['raw.jira_issues.fields:$.issuetype.name'],
    priority: ['raw.jira_issues.fields:$.priority.name'],
  },
  changes: {
    created_at: ['raw.github_pulls.created_at'],
    merged_at: ['raw.github_pulls.merged_at'],
    author: ['raw.github_pulls.user:$.login'],
  },
  metadata: {
    key: [],
    value: {
      by: 'key',
      when: { priority: ['tickets.priority'], author: ['changes.author'] },
      else: ['tickets.custom_fields'],
    },
  },
};

describe('parseColumnRef / refLabel', () => {
  it('parses table, column and JSON path', () => {
    expect(parseColumnRef('changes.merged_at')).toEqual({ table: 'changes', column: 'merged_at' });
    const ref = parseColumnRef('raw.jira_issues.fields:$.priority.name');
    expect(ref).toEqual({ table: 'raw.jira_issues', column: 'fields', path: '$.priority.name' });
    expect(ref && refLabel(ref)).toBe('fields:$.priority.name');
  });

  it('rejects malformed references', () => {
    expect(parseColumnRef('merged_at')).toBeNull();
    expect(parseColumnRef('raw.x.fields:priority')).toBeNull();
  });
});

describe('refsFor', () => {
  const keyed = MAPS.metadata?.value ?? [];

  it('picks the branch for a keyed column, falling back to else', () => {
    expect(refsFor(keyed, 'author')).toEqual(['changes.author']);
    expect(refsFor(keyed, 'votes')).toEqual(['tickets.custom_fields']);
  });

  it('takes every branch without a key value', () => {
    expect(refsFor(keyed)).toEqual(['tickets.priority', 'changes.author', 'tickets.custom_fields']);
  });
});

describe('traceField', () => {
  it('follows a field through each column map to raw columns and JSON paths', () => {
    expect(traceField(MAPS, 'lead_time', 'avg_hours', {})).toEqual({
      field: 'avg_hours',
      direct: [
        { table: 'changes', column: 'created_at' },
        { table: 'changes', column: 'merged_at' },
      ],
      columns: {
        changes: ['created_at', 'merged_at'],
        'raw.github_pulls': ['created_at', 'merged_at'],
      },
      follows: { lead_time: ['changes'], changes: ['raw.github_pulls'] },
    });
  });

  it('uses the row’s own key for a keyed column', () => {
    const trace = traceField(MAPS, 'metadata', 'value', { key: 'priority' });
    expect(trace?.columns).toEqual({
      tickets: ['priority'],
      'raw.jira_issues': ['fields:$.priority.name'],
    });
    expect(trace?.follows.metadata).toEqual(['tickets']);
  });

  it('follows every source of a row referenced by _row_id', () => {
    const trace = traceField(MAPS, 'lead_time', 'tickets', {});
    expect(trace?.columns).toEqual({ tickets: ['_row_id'] });
    expect(trace?.follows).toEqual({ lead_time: ['tickets'] });
  });

  it('marks a constant column as reading nothing', () => {
    const trace = traceField(MAPS, 'metadata', 'key', {});
    expect(trace?.direct).toEqual([]);
    expect(trace?.follows).toEqual({ metadata: [] });
  });

  it('returns null without a column map or an undeclared field', () => {
    expect(traceField(MAPS, 'unknown', 'x', {})).toBeNull();
    expect(traceField(MAPS, 'lead_time', 'nope', {})).toBeNull();
  });

  it('lists direct references by table', () => {
    const trace = traceField(MAPS, 'lead_time', 'avg_hours', {});
    expect(trace && directColumns(trace)).toEqual({ changes: ['created_at', 'merged_at'] });
  });
});

describe('expandToRaw with field lineage', () => {
  const GRAPH: Record<string, Record<string, Array<{ table: string; row_id: string }>>> = {
    lead_time: {
      '1': [
        { table: 'tickets', row_id: 't1' },
        { table: 'changes', row_id: 'c1' },
      ],
    },
    tickets: { t1: [{ table: 'raw.jira_issues', row_id: 'j1' }] },
    changes: { c1: [{ table: 'raw.github_pulls', row_id: 'p1' }] },
  };
  const fetch: FetchSources = async (table, ids) => ids.flatMap(id => GRAPH[table]?.[id] ?? []);

  it('reaches only the raw rows that feed the field', async () => {
    const trace = traceField(MAPS, 'lead_time', 'avg_hours', {});
    if (!trace) throw new Error('expected a trace');
    const { leaves } = await expandToRaw({ lead_time: ['1'] }, fetch, {
      follow: followFor(trace),
    });
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'] });
  });

  it('reaches every raw row without a field', async () => {
    const { leaves } = await expandToRaw({ lead_time: ['1'] }, fetch);
    expect(leaves).toEqual({ 'raw.github_pulls': ['p1'], 'raw.jira_issues': ['j1'] });
  });
});
