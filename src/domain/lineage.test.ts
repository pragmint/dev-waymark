import { describe, expect, it } from 'bun:test';
import type { SourceRef } from '../schemas/lineage';
import {
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  entityHrefFor,
  entityLineagePath,
  expandToRaw,
  hopToSourceRefs,
  lineagePath,
  parseRowLimit,
  groupSourcesByTable,
  hopSize,
  idColumnFor,
  isRawTable,
  isValidRowId,
  planHop,
  sourcesOf,
  withQuery,
} from './lineage';
import type { FetchSources } from './lineage';

describe('isRawTable / idColumnFor', () => {
  it('treats raw.<table> as raw, identified by _dlt_id', () => {
    expect(isRawTable('raw.jira_issues')).toBe(true);
    expect(idColumnFor('raw.jira_issues')).toBe('_dlt_id');
  });

  it('treats every other table as derived, identified by _row_id', () => {
    expect(isRawTable('tickets')).toBe(false);
    expect(isRawTable('rawish')).toBe(false);
    expect(idColumnFor('tickets')).toBe('_row_id');
  });
});

describe('isValidRowId', () => {
  it('requires an integer for derived tables', () => {
    expect(isValidRowId('tickets', '322260950709')).toBe(true);
    expect(isValidRowId('tickets', 'OzvYcUNxxHBOJw')).toBe(false);
    expect(isValidRowId('tickets', '')).toBe(false);
  });

  it('accepts any non-empty dlt id for raw tables', () => {
    expect(isValidRowId('raw.jira_issues', 'OzvYcUNx+HBOJw')).toBe(true);
    expect(isValidRowId('raw.jira_issues', '')).toBe(false);
  });
});

describe('groupSourcesByTable', () => {
  it('groups by table with unique, sorted ids', () => {
    const refs: SourceRef[] = [
      { table: 'tickets', row_id: '2' },
      { table: 'changes', row_id: '9' },
      { table: 'tickets', row_id: '1' },
      { table: 'tickets', row_id: '2' },
    ];
    expect(groupSourcesByTable(refs)).toEqual({ changes: ['9'], tickets: ['1', '2'] });
  });

  it('returns an empty hop for no refs', () => {
    expect(groupSourcesByTable([])).toEqual({});
  });
});

describe('planHop', () => {
  it('plans one lookup per table by its id column', () => {
    expect(planHop({ tickets: ['1'], 'raw.jira_issues': ['a', 'b'], changes: [] })).toEqual([
      { table: 'raw.jira_issues', idColumn: '_dlt_id', ids: ['a', 'b'] },
      { table: 'tickets', idColumn: '_row_id', ids: ['1'] },
    ]);
  });
});

// A small graph shaped like the Kafka run: an aggregate built from tickets and
// changes, each built from one raw record.
const GRAPH: Record<string, Record<string, SourceRef[]>> = {
  lead_time: {
    '100': [
      { table: 'tickets', row_id: '1' },
      { table: 'tickets', row_id: '2' },
      { table: 'changes', row_id: '7' },
    ],
  },
  tickets: {
    '1': [{ table: 'raw.jira_issues', row_id: 'j1' }],
    '2': [{ table: 'raw.jira_issues', row_id: 'j2' }],
  },
  changes: { '7': [{ table: 'raw.github_pulls', row_id: 'p7' }] },
};

function fakeFetcher(graph: Record<string, Record<string, SourceRef[]>>) {
  const calls: Array<[string, string[]]> = [];
  const fetch: FetchSources = async (table, ids) => {
    calls.push([table, ids]);
    return ids.flatMap(id => graph[table]?.[id] ?? []);
  };
  return { fetch, calls };
}

describe('expandToRaw', () => {
  it('follows every hop to the raw leaves', async () => {
    const { fetch } = fakeFetcher(GRAPH);
    const { hops, leaves } = await expandToRaw({ lead_time: ['100'] }, fetch);
    expect(hops).toEqual([
      { lead_time: ['100'] },
      { changes: ['7'], tickets: ['1', '2'] },
      { 'raw.github_pulls': ['p7'], 'raw.jira_issues': ['j1', 'j2'] },
    ]);
    expect(leaves).toEqual({ 'raw.github_pulls': ['p7'], 'raw.jira_issues': ['j1', 'j2'] });
    expect(hopSize(leaves)).toBe(3);
  });

  it('returns a raw start as its own leaf', async () => {
    const { fetch, calls } = fakeFetcher(GRAPH);
    const { hops, leaves } = await expandToRaw({ 'raw.jira_issues': ['j1'] }, fetch);
    expect(hops).toEqual([{ 'raw.jira_issues': ['j1'] }]);
    expect(leaves).toEqual({ 'raw.jira_issues': ['j1'] });
    expect(calls).toEqual([]);
  });

  it('collects raw rows reached at different depths', async () => {
    const graph = {
      summary: {
        s: [
          { table: 'raw.jira_issues', row_id: 'j0' },
          { table: 'tickets', row_id: '1' },
        ],
      },
      tickets: GRAPH.tickets ?? {},
    };
    const { fetch } = fakeFetcher(graph);
    const { leaves } = await expandToRaw({ summary: ['s'] }, fetch);
    expect(leaves).toEqual({ 'raw.jira_issues': ['j0', 'j1'] });
  });

  it('expands a row reached by two paths only once', async () => {
    const graph = {
      top: {
        t: [
          { table: 'mid', row_id: 'a' },
          { table: 'tickets', row_id: '1' },
        ],
      },
      mid: { a: [{ table: 'tickets', row_id: '1' }] },
      tickets: GRAPH.tickets ?? {},
    };
    const { fetch, calls } = fakeFetcher(graph);
    const { hops } = await expandToRaw({ top: ['t'] }, fetch);
    expect(calls.filter(([table]) => table === 'tickets')).toEqual([['tickets', ['1']]]);
    expect(hops).toHaveLength(3);
  });

  it('ends a cycle once every row in it has been seen', async () => {
    const { fetch } = fakeFetcher({
      a: { '1': [{ table: 'b', row_id: '1' }] },
      b: { '1': [{ table: 'a', row_id: '1' }] },
    });
    expect(await expandToRaw({ a: ['1'] }, fetch)).toEqual({
      hops: [{ a: ['1'] }, { b: ['1'] }],
      leaves: {},
    });
  });

  it('stops an unbounded chain at the hop limit', async () => {
    // Fresh ids each hop defeat the seen-set, so only the hop limit stops it.
    let n = 0;
    const fetch: FetchSources = async table => [
      { table: table === 'a' ? 'b' : 'a', row_id: String(++n) },
    ];
    await expect(expandToRaw({ a: ['0'] }, fetch, { maxHops: 5 })).rejects.toThrow('within 5 hops');
  });

  it('ends without leaves when a derived row has no sources', async () => {
    const { fetch } = fakeFetcher({});
    expect(await expandToRaw({ tickets: ['404'] }, fetch)).toEqual({
      hops: [{ tickets: ['404'] }],
      leaves: {},
    });
  });
});

describe('parseRowLimit', () => {
  it('defaults when missing or invalid', () => {
    expect(parseRowLimit(undefined)).toBe(DEFAULT_ROW_LIMIT);
    expect(parseRowLimit('abc')).toBe(DEFAULT_ROW_LIMIT);
    expect(parseRowLimit('0')).toBe(DEFAULT_ROW_LIMIT);
  });

  it('caps large and "all" limits', () => {
    expect(parseRowLimit('250')).toBe(250);
    expect(parseRowLimit('999999')).toBe(MAX_ROW_LIMIT);
    expect(parseRowLimit('all')).toBe(MAX_ROW_LIMIT);
  });
});

describe('lineagePath', () => {
  it('encodes dlt ids that contain URL characters', () => {
    expect(lineagePath('raw.jira_issues', 'a+b/c')).toBe('/lineage/raw.jira_issues/a%2Bb%2Fc');
    expect(lineagePath('tickets', '12', '/raw')).toBe('/lineage/tickets/12/raw');
  });
});

describe('sourcesOf', () => {
  const row = {
    rowId: '1',
    values: { _row_id: '1', _sources: [{ table: 'raw.jira_issues', row_id: 'j1' }] },
  };

  it('returns a derived row’s sources', () => {
    expect(sourcesOf('tickets', row)).toEqual([{ table: 'raw.jira_issues', row_id: 'j1' }]);
  });

  it('returns none for a raw row or a row without sources', () => {
    expect(sourcesOf('raw.jira_issues', row)).toEqual([]);
    expect(sourcesOf('tickets', { rowId: '2', values: {} })).toEqual([]);
  });

  it('rejects malformed sources', () => {
    expect(() => sourcesOf('tickets', { rowId: '3', values: { _sources: [{}] } })).toThrow();
  });
});

describe('hopToSourceRefs', () => {
  it('inverts groupSourcesByTable', () => {
    const hop = { changes: ['7'], tickets: ['1', '2'] };
    expect(groupSourcesByTable(hopToSourceRefs(hop))).toEqual(hop);
  });
});

describe('entity links', () => {
  it('links an entity to its lineage row and back', () => {
    expect(entityLineagePath(101)).toBe('/lineage/entities/101');
    expect(entityHrefFor('entities', '101')).toBe('/entities/101');
    expect(entityHrefFor('tickets', '101')).toBeUndefined();
  });
});

describe('withQuery', () => {
  it('encodes values and leaves out empty ones', () => {
    expect(withQuery('/lineage/t/1', { field: 'a b', limit: undefined })).toBe(
      '/lineage/t/1?field=a%20b'
    );
    expect(withQuery('/lineage/t/1', {})).toBe('/lineage/t/1');
  });
});
