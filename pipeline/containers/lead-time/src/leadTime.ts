// Hours from a ticket's first pull request opening to its last one merging, by issue type: the
// same table as the SQL job in reference/lead_time_by_issue_type, in TypeScript.
import { type Fields, type SourceRef, sourceRef, stableId } from './contract';

export const TABLE = 'lead_time_by_issue_type';

/** The columns of an `entities` row this job reads. */
export type Entity = {
  _row_id: bigint;
  type: string | null;
  issue_type: string | null;
  /** `YYYY-MM-DDTHH:MM:SSZ` text, as `iso_utc` writes it. */
  created_at: string | null;
  /** Microseconds since the epoch. */
  merged_at: bigint | null;
};

export type Link = { _row_id: bigint; ticket_id: bigint | null; change_id: bigint | null };

export type LeadTimeRow = {
  _row_id: bigint;
  _sources: SourceRef[];
  _fields: Fields;
  issue_type: string | null;
  tickets: bigint;
  avg_lead_time_hours: number | null;
  median_lead_time_hours: number | null;
};

// Which changes count toward a ticket depends on its links; a ticket counts once one merged.
const LEAD_TIME_REFS = [
  'entities[type=change].created_at',
  'entities[type=change].merged_at',
  'ticket_change_links._row_id',
];
export const FIELDS: Fields = {
  issue_type: ['entities.issue_type'],
  tickets: [
    'entities[type=ticket]._row_id',
    'ticket_change_links._row_id',
    'entities[type=change].merged_at',
  ],
  avg_lead_time_hours: LEAD_TIME_REFS,
  median_lead_time_hours: LEAD_TIME_REFS,
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MICROS_PER_MINUTE = 60_000_000n;

/** `iso_utc` text as microseconds, or null for anything else, like SQL's `try_cast`. */
export function parseIsoUtc(text: string | null): bigint | null {
  if (text === null || !ISO_UTC.test(text)) {
    return null;
  }
  const millis = Date.parse(text);
  return Number.isNaN(millis) ? null : BigInt(millis) * 1000n;
}

/** Whole minute boundaries crossed between two instants, as SQL's `date_diff('minute', a, b)`. */
export function minutesBetween(from: bigint, to: bigint): bigint {
  const floorMinute = (micros: bigint) => {
    const minute = micros / MICROS_PER_MINUTE;
    return micros < 0n && micros % MICROS_PER_MINUTE !== 0n ? minute - 1n : minute;
  };
  return floorMinute(to) - floorMinute(from);
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

const earlier = (a: bigint | null, b: bigint | null) =>
  a === null || (b !== null && b < a) ? b : a;
const later = (a: bigint | null, b: bigint | null) => (a === null || (b !== null && b > a) ? b : a);

type TicketTimes = {
  ticket: Entity;
  firstCreated: bigint | null;
  lastMerged: bigint | null;
  sources: SourceRef[];
};

/** Each linked ticket with its changes' first opening and last merge, and the rows behind them. */
function ticketTimes(entities: Entity[], links: Link[]): TicketTimes[] {
  const byId = new Map(entities.map(entity => [entity._row_id, entity]));
  const perTicket = new Map<bigint, TicketTimes>();
  for (const link of links) {
    const ticket = link.ticket_id === null ? undefined : byId.get(link.ticket_id);
    const change = link.change_id === null ? undefined : byId.get(link.change_id);
    if (ticket?.type !== 'ticket' || change === undefined) {
      continue;
    }
    const times = perTicket.get(ticket._row_id) ?? {
      ticket,
      firstCreated: null,
      lastMerged: null,
      sources: [],
    };
    times.firstCreated = earlier(times.firstCreated, parseIsoUtc(change.created_at));
    times.lastMerged = later(times.lastMerged, change.merged_at);
    times.sources.push(
      sourceRef('entities', change._row_id),
      sourceRef('ticket_change_links', link._row_id)
    );
    perTicket.set(ticket._row_id, times);
  }
  return [...perTicket.values()];
}

function hours(times: TicketTimes): number | null {
  if (times.firstCreated === null || times.lastMerged === null) {
    return null;
  }
  return Number(minutesBetween(times.firstCreated, times.lastMerged)) / 60;
}

function summarize(client: string, issueType: string | null, group: TicketTimes[]): LeadTimeRow {
  const known = group.map(hours).filter((value): value is number => value !== null);
  const avg = average(known);
  const middle = median(known);
  return {
    _row_id: stableId(client, TABLE, issueType ?? ''),
    _sources: [
      ...group.map(times => sourceRef('entities', times.ticket._row_id)),
      ...group.flatMap(times => times.sources),
    ],
    _fields: FIELDS,
    issue_type: issueType,
    tickets: BigInt(group.length),
    avg_lead_time_hours: avg === null ? null : roundTo(avg, 1),
    median_lead_time_hours: middle === null ? null : roundTo(middle, 1),
  };
}

/** One row per issue type, over the tickets with at least one merged pull request. */
export function leadTimeByIssueType(client: string, entities: Entity[], links: Link[]) {
  const groups = new Map<string | null, TicketTimes[]>();
  for (const times of ticketTimes(entities, links)) {
    if (times.lastMerged === null) {
      continue;
    }
    const group = groups.get(times.ticket.issue_type) ?? [];
    group.push(times);
    groups.set(times.ticket.issue_type, group);
  }
  const rows = [...groups].map(([issueType, group]) => summarize(client, issueType, group));
  return rows.sort(
    (a, b) =>
      Number(b.tickets - a.tickets) || (a.issue_type ?? '').localeCompare(b.issue_type ?? '')
  );
}
