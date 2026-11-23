// Lead time by issue type, from each ticket's metadata: the same entities as the SQL job in
// reference/lead_time_by_issue_type, in TypeScript.
import { type Fields, type SourceRef, sourceRef, stableId } from './contract';

export const ENTITY_TYPE = 'lead_time_by_issue_type';

/** The columns of an `entity_metadata` row this job reads. */
export type MetadataRow = {
  _row_id: bigint;
  /** Null only when verify perturbs it; such rows still group together, as SQL's `group by`. */
  entity_id: bigint | null;
  key: string | null;
  value: string | null;
};

export type LeadTimeRow = {
  _row_id: bigint;
  _sources: SourceRef[];
  _fields: Fields;
  name: string;
  /** `YYYY-MM-DDTHH:MM:SSZ` text, as `iso_utc` writes it. */
  created_at: string;
  issue_type: string | null;
  tickets: bigint;
  avg_lead_time_hours: number | null;
  median_lead_time_hours: number | null;
};

// Which tickets count depends on their issue type and having a lead time. Each reference names a
// ticket's metadata value as `entities.<key>`, and `_sources` cites the ticket itself.
const TICKET_REFS = ['entities.issue_type', 'entities.last_merged_at', 'entities.lead_time_hours'];
export const FIELDS: Fields = {
  name: ['entities.issue_type'],
  // An entity needs a date; an issue type's is its most recent merge.
  created_at: TICKET_REFS,
  issue_type: ['entities.issue_type'],
  tickets: TICKET_REFS,
  avg_lead_time_hours: TICKET_REFS,
  median_lead_time_hours: TICKET_REFS,
};

const KEYS = new Set(['issue_type', 'lead_time_hours', 'last_merged_at']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** `iso_utc` text as milliseconds, or null for anything else, like SQL's `try_cast`. */
export function parseIsoUtc(text: string | null): number | null {
  if (text === null || !ISO_UTC.test(text)) {
    return null;
  }
  const millis = Date.parse(text);
  return Number.isNaN(millis) ? null : millis;
}

/** Milliseconds as `iso_utc` text. */
export function isoUtc(millis: number): string {
  return new Date(millis).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A number written as text, or null for anything else, like SQL's `try_cast(... as double)`. */
export function parseNumber(text: string | null): number | null {
  return text !== null && NUMBER.test(text) ? Number(text) : null;
}

/** Rounded half away from zero, as SQL's `round(x, digits)`. */
export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale;
}

/** The middle value, or the two middle values interpolated, as SQL's `median`. */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) / 2;
  const low = sorted[Math.floor(position)];
  const high = sorted[Math.ceil(position)];
  return low + (position - Math.floor(position)) * (high - low);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

type Ticket = {
  issueType: string | null;
  hours: number | null;
  lastMerged: number | null;
  sources: SourceRef[];
};

/** Each ticket's issue type, lead time and last merge, gathered from its metadata rows. */
function tickets(metadata: MetadataRow[]): Ticket[] {
  const perTicket = new Map<bigint | null, Ticket>();
  for (const row of metadata) {
    if (row.key === null || !KEYS.has(row.key)) {
      continue;
    }
    const ticket = perTicket.get(row.entity_id) ?? {
      issueType: null,
      hours: null,
      lastMerged: null,
      sources: [],
    };
    if (row.key === 'issue_type') {
      ticket.issueType = row.value;
    } else if (row.key === 'lead_time_hours') {
      ticket.hours = parseNumber(row.value);
    } else {
      ticket.lastMerged = parseIsoUtc(row.value);
    }
    if (ticket.sources.length === 0 && row.entity_id !== null) {
      ticket.sources.push(sourceRef('entities', row.entity_id));
    }
    perTicket.set(row.entity_id, ticket);
  }
  return [...perTicket.values()].filter(t => t.hours !== null && t.lastMerged !== null);
}

function summarize(client: string, issueType: string | null, group: Ticket[]): LeadTimeRow {
  const hours = group.map(ticket => ticket.hours ?? 0);
  const avg = average(hours);
  const middle = median(hours);
  return {
    _row_id: stableId(client, ENTITY_TYPE, issueType ?? ''),
    _sources: group
      .flatMap(ticket => ticket.sources)
      .sort((a, b) => Number(BigInt(a.row_id) - BigInt(b.row_id))),
    _fields: FIELDS,
    name: issueType ?? 'No issue type',
    created_at: isoUtc(Math.max(...group.map(ticket => ticket.lastMerged ?? 0))),
    issue_type: issueType,
    tickets: BigInt(group.length),
    avg_lead_time_hours: avg === null ? null : roundTo(avg, 1),
    median_lead_time_hours: middle === null ? null : roundTo(middle, 1),
  };
}

/** One entity per issue type, over the tickets with a lead time, dated by its latest merge. */
export function leadTimeByIssueType(client: string, metadata: MetadataRow[]): LeadTimeRow[] {
  const groups = new Map<string | null, Ticket[]>();
  for (const ticket of tickets(metadata)) {
    const group = groups.get(ticket.issueType) ?? [];
    group.push(ticket);
    groups.set(ticket.issueType, group);
  }
  const rows = [...groups].map(([issueType, group]) => summarize(client, issueType, group));
  return rows.sort(
    (a, b) =>
      Number(b.tickets - a.tickets) || (a.issue_type ?? '').localeCompare(b.issue_type ?? '')
  );
}
