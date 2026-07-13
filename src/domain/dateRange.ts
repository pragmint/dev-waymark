import { z } from 'zod';
import { makeLeaf } from '../schemas/filterTree';
import type { FilterNode } from '../schemas/filterTree';
import type { NamedWindow, VisualizationConfig } from '../schemas/visualization';

// ── Schema + types ────────────────────────────────────────────────────────────

export const DateRangePeriodSchema = z.enum(['all', 'week', 'month', 'quarter', 'year', 'custom']);
export type DateRangePeriod = z.infer<typeof DateRangePeriodSchema>;

export type DateRange = {
  period: DateRangePeriod;
  // Number of full periods to shift from "now". 0 = current period, -1 = previous, +1 = next.
  // Only meaningful when period is week/month/quarter/year.
  offset: number;
  // YYYY-MM-DD strings, only meaningful when period === 'custom'.
  customStart: string | null;
  customEnd: string | null;
};

export type ComputedDateRange = {
  // null when the range is unbounded (all-time, or custom with one side blank).
  start: Date | null;
  end: Date | null;
  // Human label for the stepper widget: "June 2026", "Q2 2026", "2026", "Week of Jun 22, 2026",
  // "All time", or "Jun 1 – Jun 30, 2026".
  label: string;
};

export const DEFAULT_DATE_RANGE: DateRange = {
  period: 'all',
  offset: 0,
  customStart: null,
  customEnd: null,
};

// ── Query-string round-trip ───────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRangeFromQuery(params: URLSearchParams): DateRange {
  const rawPeriod = params.get('range');
  const periodParsed = DateRangePeriodSchema.safeParse(rawPeriod);
  const period: DateRangePeriod = periodParsed.success ? periodParsed.data : 'all';

  const offsetRaw = params.get('offset');
  const offsetN = offsetRaw == null ? 0 : parseInt(offsetRaw, 10);
  const offset = Number.isFinite(offsetN) ? offsetN : 0;

  const rsRaw = params.get('rs');
  const reRaw = params.get('re');
  const customStart = rsRaw && ISO_DATE.test(rsRaw) ? rsRaw : null;
  const customEnd = reRaw && ISO_DATE.test(reRaw) ? reRaw : null;

  return { period, offset, customStart, customEnd };
}

// Returns a query string fragment (e.g. "range=month&offset=-1") with only the
// params relevant to the chosen period. Always omitted when at defaults so the
// URL stays clean.
export function dateRangeToQueryParts(range: DateRange): string[] {
  const parts: string[] = [];
  if (range.period !== 'all') parts.push(`range=${encodeURIComponent(range.period)}`);
  if (range.period !== 'all' && range.period !== 'custom' && range.offset !== 0) {
    parts.push(`offset=${range.offset}`);
  }
  if (range.period === 'custom') {
    if (range.customStart) parts.push(`rs=${encodeURIComponent(range.customStart)}`);
    if (range.customEnd) parts.push(`re=${encodeURIComponent(range.customEnd)}`);
  }
  return parts;
}

// ── Period math (UTC) ─────────────────────────────────────────────────────────
//
// All date math runs in UTC so it matches chartDataBuilder.bucketDate/bucketRange,
// which use UTC for week starts, month names, etc. Otherwise the range would not
// line up with the chart bin labels.

function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const shift = day === 0 ? -6 : 1 - day; // ISO week starts Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function endOfMonthUTC(year: number, month: number): Date {
  // Day 0 of next month = last day of this month, at end-of-day.
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatDayUTC(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── Range computation ─────────────────────────────────────────────────────────

export function computeDateRange(range: DateRange, now: Date): ComputedDateRange {
  switch (range.period) {
    case 'all':
      return { start: null, end: null, label: 'All time' };

    case 'custom': {
      const start = range.customStart ? new Date(`${range.customStart}T00:00:00Z`) : null;
      const end = range.customEnd ? new Date(`${range.customEnd}T23:59:59.999Z`) : null;
      let label = 'Custom';
      if (start && end) label = `${formatDayUTC(start)} – ${formatDayUTC(end)}`;
      else if (start) label = `From ${formatDayUTC(start)}`;
      else if (end) label = `Until ${formatDayUTC(end)}`;
      return { start, end, label };
    }

    case 'week': {
      const baseMonday = startOfWeekUTC(now);
      const start = addUTCDays(baseMonday, range.offset * 7);
      const end = new Date(addUTCDays(start, 6).getTime() + 86_399_999); // end-of-Sunday
      const label = `Week of ${formatDayUTC(start)}`;
      return { start, end, label };
    }

    case 'month': {
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth() + range.offset;
      const start = startOfMonthUTC(y, m);
      const end = endOfMonthUTC(y, m);
      const label = `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
      return { start, end, label };
    }

    case 'quarter': {
      const baseQuarter = Math.floor(now.getUTCMonth() / 3);
      const totalQuarters = baseQuarter + range.offset;
      const targetYear = now.getUTCFullYear() + Math.floor(totalQuarters / 4);
      const targetQuarter = ((totalQuarters % 4) + 4) % 4;
      const startMonth = targetQuarter * 3;
      const start = startOfMonthUTC(targetYear, startMonth);
      const end = endOfMonthUTC(targetYear, startMonth + 2);
      const label = `Q${targetQuarter + 1} ${targetYear}`;
      return { start, end, label };
    }

    case 'year': {
      const year = now.getUTCFullYear() + range.offset;
      const start = startOfMonthUTC(year, 0);
      const end = endOfMonthUTC(year, 11);
      return { start, end, label: `${year}` };
    }
  }
}

// ── Named relative windows (compare-periods template) ─────────────────────────
//
// Discrete calendar periods resolved against a caller-supplied `now` (never a
// hidden clock, so it stays testable). Week/month windows reuse computeDateRange
// with an offset so the bounds match the dashboard range control exactly. A
// multi-period comparison is expressed as several discrete windows (e.g.
// month_minus_2 + last_month + this_month), not a single span.

export type ResolvedWindow = { label: string; start: Date | null; end: Date | null };

const CALENDAR_WINDOW_SPEC: Record<
  Exclude<NamedWindow, 'all_time' | 'this_mon_fri'>,
  { period: 'week' | 'month'; offset: number; label: string }
> = {
  this_week: { period: 'week', offset: 0, label: 'This week' },
  last_week: { period: 'week', offset: -1, label: 'Last week' },
  week_minus_2: { period: 'week', offset: -2, label: '2 weeks ago' },
  this_month: { period: 'month', offset: 0, label: 'This month' },
  last_month: { period: 'month', offset: -1, label: 'Last month' },
  month_minus_2: { period: 'month', offset: -2, label: '2 months ago' },
};

export function resolveNamedWindow(w: NamedWindow, now: Date): ResolvedWindow {
  if (w === 'all_time') return { label: 'All time', start: null, end: null };
  if (w === 'this_mon_fri') {
    const start = startOfWeekUTC(now);
    return { label: 'This Mon–Fri', start, end: new Date(addUTCDays(start, 5).getTime() - 1) };
  }
  const spec = CALENDAR_WINDOW_SPEC[w];
  const r = computeDateRange(
    { period: spec.period, offset: spec.offset, customStart: null, customEnd: null },
    now
  );
  return { label: spec.label, start: r.start, end: r.end };
}

// Whether an ISO/parsable date string falls within an inclusive window's bounds.
export function inWindow(dateStr: string, win: { start: Date | null; end: Date | null }): boolean {
  const t = Date.parse(dateStr);
  if (isNaN(t)) return false;
  if (win.start && t < win.start.getTime()) return false;
  if (win.end && t > win.end.getTime()) return false;
  return true;
}

// ── Visualization date-field resolution ───────────────────────────────────────
//
// The dashboard range filter applies to each viz's "primary date field". We
// pick the field most likely to be on the X-axis of the chart's time dimension
// so the filter visually narrows the chart along its time axis.

export function resolveVizDateField(config: VisualizationConfig): string | null {
  if (config.xAxis?.type === 'date') return config.xAxis.metadataKey;
  if (config.derivedMetric?.type === 'duration') return config.derivedMetric.startMetadataKey;
  return null;
}

// ── Filter-node construction ──────────────────────────────────────────────────
//
// gte uses YYYY-MM-DD so it matches entities stored as bare dates AND as full
// ISO timestamps under SQLite's lex comparison (same convention as bucketRange
// in chartDataBuilder).

function toGteValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toLteValue(d: Date): string {
  return d.toISOString();
}

export function buildDateRangeFilters(
  computed: ComputedDateRange,
  dateMetadataKey: string
): FilterNode[] {
  const nodes: FilterNode[] = [];
  if (computed.start) nodes.push(makeLeaf(dateMetadataKey, 'gte', toGteValue(computed.start)));
  if (computed.end) nodes.push(makeLeaf(dateMetadataKey, 'lte', toLteValue(computed.end)));
  return nodes;
}
