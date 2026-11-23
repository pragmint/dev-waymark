import { describe, expect, test } from 'bun:test';
import { readJobEnv, stableId } from './contract';
import {
  FIELDS,
  type MetadataRow,
  isoUtc,
  leadTimeByIssueType,
  median,
  parseIsoUtc,
  parseNumber,
  roundTo,
} from './leadTime';

const CLIENT = 'apache-kafka';

let nextId = 1000n;
function metadata(entityId: bigint, key: string, value: string | null): MetadataRow {
  nextId += 1n;
  return { _row_id: nextId, entity_id: entityId, key, value };
}

function ticket(id: bigint, issueType: string | null, hours: string | null, merged: string | null) {
  return [
    ...(issueType === null ? [] : [metadata(id, 'issue_type', issueType)]),
    ...(hours === null ? [] : [metadata(id, 'lead_time_hours', hours)]),
    ...(merged === null ? [] : [metadata(id, 'last_merged_at', merged)]),
    metadata(id, 'summary', 'not read'),
  ];
}

describe('stableId', () => {
  test('matches the runner’s stable_id for the same client, kind and key', () => {
    // From lead_time_by_issue_type in the Kafka snapshot 20261119T200000Z.
    expect(stableId(CLIENT, 'lead_time_by_issue_type', 'Task')).toBe(8767488532554951n);
    expect(stableId(CLIENT, 'lead_time_by_issue_type', 'Wish')).toBe(778819069606660n);
  });

  test('fits in 53 bits', () => {
    expect(stableId(CLIENT, 'kind', 'key')).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

describe('the SQL semantics it reproduces', () => {
  test('parseIsoUtc reads iso_utc text and nothing else, like try_cast', () => {
    expect(parseIsoUtc('2024-01-01T00:00:00Z')).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(parseIsoUtc('2024-01-01T00:00:00Z~')).toBeNull();
    expect(parseIsoUtc('~perturbed~')).toBeNull();
    expect(parseIsoUtc(null)).toBeNull();
  });

  test('isoUtc writes what iso_utc does', () => {
    expect(isoUtc(Date.parse('2024-01-01T10:00:00Z'))).toBe('2024-01-01T10:00:00Z');
  });

  test('parseNumber reads a number and nothing else, like try_cast', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('12.5~')).toBeNull();
    expect(parseNumber('~perturbed~')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  test('roundTo rounds half away from zero, like round', () => {
    expect(roundTo(1.25, 1)).toBe(1.3);
    expect(roundTo(-1.25, 1)).toBe(-1.3);
  });

  test('median interpolates between the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('leadTimeByIssueType', () => {
  const rows = leadTimeByIssueType(CLIENT, [
    ...ticket(1n, 'Bug', '6', '2024-01-01T06:00:00Z'),
    ...ticket(2n, 'Bug', '1', '2024-01-02T01:00:00Z'),
    // No lead time: no pull request merged.
    ...ticket(3n, 'Task', null, null),
    ...ticket(4n, 'Task', '2', '2024-01-04T00:00:00Z'),
    // A lead time that isn't a number doesn't count.
    ...ticket(5n, 'Task', 'soon', '2024-01-05T00:00:00Z'),
    ...ticket(6n, null, '4', '2024-01-06T00:00:00Z'),
  ]);
  const byName = new Map(rows.map(row => [row.name, row]));

  test('averages each issue type’s tickets with a lead time', () => {
    expect(byName.get('Bug')).toMatchObject({ tickets: 2n, avg_lead_time_hours: 3.5 });
    expect(byName.get('Bug')?.median_lead_time_hours).toBe(3.5);
    expect(byName.get('Task')).toMatchObject({ tickets: 1n, avg_lead_time_hours: 2 });
  });

  test('names each entity for its issue type and dates it by its latest merge', () => {
    expect(byName.get('Bug')?.created_at).toBe('2024-01-02T01:00:00Z');
    expect(byName.get('No issue type')).toMatchObject({ issue_type: null, tickets: 1n });
  });

  test('cites each ticket it counted once, as an entity, and none it skipped', () => {
    expect(byName.get('Bug')?._sources).toEqual([
      { table: 'entities', row_id: '1' },
      { table: 'entities', row_id: '2' },
    ]);
    expect(byName.get('Task')?._sources).toEqual([{ table: 'entities', row_id: '4' }]);
  });

  test('declares the same _fields as the SQL job, keyed by issue type', () => {
    expect(rows.map(row => row._fields)).toEqual([FIELDS, FIELDS, FIELDS]);
    expect(byName.get('Bug')?._row_id).toBe(stableId(CLIENT, 'lead_time_by_issue_type', 'Bug'));
  });

  test('orders rows by ticket count, most first', () => {
    expect(rows.map(row => row.name)).toEqual(['Bug', 'No issue type', 'Task']);
  });
});

describe('readJobEnv', () => {
  const env = {
    WAYMARK_INPUTS: '{"entity_metadata": "file:///waymark/in/entity_metadata.parquet"}',
    WAYMARK_CHANGES: '{}',
    WAYMARK_PARAMS: '{"client": "apache-kafka"}',
    WAYMARK_OUTPUT: '/waymark/out/output.parquet',
  };

  test('reads the inputs, changes, params and output', () => {
    expect(readJobEnv(env)).toMatchObject({
      inputs: { entity_metadata: 'file:///waymark/in/entity_metadata.parquet' },
      changes: {},
      params: { client: 'apache-kafka' },
      output: '/waymark/out/output.parquet',
    });
  });

  test('refuses a missing variable', () => {
    expect(() => readJobEnv({ ...env, WAYMARK_OUTPUT: undefined })).toThrow('WAYMARK_OUTPUT');
    expect(() => readJobEnv({ ...env, WAYMARK_INPUTS: undefined })).toThrow('WAYMARK_INPUTS');
  });
});
