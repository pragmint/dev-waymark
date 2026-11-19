import { describe, expect, test } from 'bun:test';
import { readJobEnv, stableId } from './contract';
import {
  type Entity,
  FIELDS,
  type Link,
  leadTimeByIssueType,
  median,
  minutesBetween,
  parseIsoUtc,
  roundTo,
} from './leadTime';

const CLIENT = 'apache-kafka';
const at = (iso: string) => BigInt(Date.parse(iso)) * 1000n;

function ticket(id: bigint, issueType: string | null): Entity {
  return { _row_id: id, type: 'ticket', issue_type: issueType, created_at: null, merged_at: null };
}

function change(id: bigint, createdAt: string | null, mergedAt: string | null): Entity {
  return {
    _row_id: id,
    type: 'change',
    issue_type: null,
    created_at: createdAt,
    merged_at: mergedAt === null ? null : at(mergedAt),
  };
}

const link = (id: bigint, ticketId: bigint, changeId: bigint): Link => ({
  _row_id: id,
  ticket_id: ticketId,
  change_id: changeId,
});

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
    expect(parseIsoUtc('2024-01-01T00:00:00Z')).toBe(at('2024-01-01T00:00:00Z'));
    expect(parseIsoUtc('2024-01-01T00:00:00Z~')).toBeNull();
    expect(parseIsoUtc('~perturbed~')).toBeNull();
    expect(parseIsoUtc(null)).toBeNull();
  });

  test('minutesBetween counts minute boundaries, like date_diff', () => {
    expect(minutesBetween(at('2024-01-01T10:00:59Z'), at('2024-01-01T10:01:00Z'))).toBe(1n);
    expect(minutesBetween(at('2024-01-01T10:00:00Z'), at('2024-01-01T10:00:59Z'))).toBe(0n);
    expect(minutesBetween(at('1969-12-31T23:59:30Z'), at('1970-01-01T00:00:00Z'))).toBe(1n);
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
  const entities = [
    ticket(1n, 'Bug'),
    ticket(2n, 'Bug'),
    ticket(3n, 'Task'),
    ticket(4n, 'Task'),
    change(10n, '2024-01-01T00:00:00Z', '2024-01-01T02:00:00Z'),
    change(11n, '2024-01-01T01:00:00Z', '2024-01-01T06:00:00Z'),
    change(12n, '2024-01-02T00:00:00Z', '2024-01-02T01:00:00Z'),
    change(13n, '2024-01-03T00:00:00Z', null),
    change(14n, 'not a date', '2024-01-04T00:00:00Z'),
  ];
  const links = [
    link(100n, 1n, 10n),
    link(101n, 1n, 11n),
    link(102n, 2n, 12n),
    link(103n, 3n, 13n),
    link(104n, 4n, 14n),
    // A link to a change that is not in entities, and one whose "ticket" is a change.
    link(105n, 1n, 99n),
    link(106n, 10n, 11n),
  ];
  const rows = leadTimeByIssueType(CLIENT, entities, links);

  test('spans a ticket’s first change opening to its last merging, averaged by issue type', () => {
    const bug = rows.find(row => row.issue_type === 'Bug');
    // Ticket 1: 00:00 to 06:00 is 6 hours; ticket 2: 1 hour.
    expect(bug).toMatchObject({ tickets: 2n, avg_lead_time_hours: 3.5 });
    expect(bug?.median_lead_time_hours).toBe(3.5);
  });

  test('counts only tickets with a merged change, and a ticket with no valid start counts', () => {
    const task = rows.find(row => row.issue_type === 'Task');
    // Ticket 3's only change never merged; ticket 4's change has no parseable created_at.
    expect(task).toMatchObject({ tickets: 1n, avg_lead_time_hours: null });
  });

  test('lists the tickets, their changes and the links between them as sources', () => {
    const bug = rows.find(row => row.issue_type === 'Bug');
    const sources = new Set(bug?._sources.map(source => `${source.table}:${source.row_id}`));
    expect(sources).toEqual(
      new Set([
        'entities:1',
        'entities:2',
        'entities:10',
        'entities:11',
        'entities:12',
        'ticket_change_links:100',
        'ticket_change_links:101',
        'ticket_change_links:102',
      ])
    );
  });

  test('declares the same _fields as the SQL job, keyed by issue type', () => {
    expect(rows.map(row => row._fields)).toEqual([FIELDS, FIELDS]);
    expect(rows[0]._row_id).toBe(stableId(CLIENT, 'lead_time_by_issue_type', 'Bug'));
  });

  test('orders rows by ticket count, most first', () => {
    expect(rows.map(row => row.issue_type)).toEqual(['Bug', 'Task']);
  });
});

describe('readJobEnv', () => {
  const env = {
    WAYMARK_INPUTS: '{"entities": "file:///waymark/in/entities.parquet"}',
    WAYMARK_CHANGES: '{}',
    WAYMARK_PARAMS: '{"client": "apache-kafka"}',
    WAYMARK_OUTPUT: '/waymark/out/output.parquet',
  };

  test('reads the inputs, changes, params and output', () => {
    expect(readJobEnv(env)).toMatchObject({
      inputs: { entities: 'file:///waymark/in/entities.parquet' },
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
