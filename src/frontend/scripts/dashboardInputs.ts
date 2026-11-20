// Parsers for the server's JSON embeds and the URL query that dashboard.ts
// reads. Each returns only well-typed values, and the rest of the script trusts
// nothing else. Ids and offsets end up in URLs and form actions, so they must be
// numbers here, not merely typed as numbers.
//
// These are hand-written rather than Zod schemas on purpose: the dashboard
// bundle has no Zod in it, and these few shapes don't justify adding it. Only
// types come from src/domain/dateRange.ts, so it stays out of the bundle too.
import type { DateRange, DateRangePeriod } from '../../domain/dateRange';

const PERIODS: readonly DateRangePeriod[] = ['all', 'week', 'month', 'quarter', 'year', 'custom'];

export const DEFAULT_DATE_RANGE: DateRange = {
  period: 'all',
  offset: 0,
  customStart: null,
  customEnd: null,
  compare: false,
  compareCustomStart: null,
  compareCustomEnd: null,
};

export interface PresetEntry {
  id: number;
  name: string;
}

export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  chartType: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  const n = asInteger(value);
  return n != null && n > 0 ? n : null;
}

function asIsoDate(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null;
}

// Returns the matching constant, never the input itself.
function asPeriod(value: unknown): DateRangePeriod | null {
  return PERIODS.find(p => p === value) ?? null;
}

export function parseDashboardConfig(raw: unknown): { dashboardId: number | null } {
  return { dashboardId: asPositiveInteger(asRecord(raw).dashboardId) };
}

export function parseVizIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(asPositiveInteger).filter((id): id is number => id != null);
}

export function parseVizDashboardCounts(raw: unknown): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const [key, value] of Object.entries(asRecord(raw))) {
    const id = asPositiveInteger(Number(key));
    const count = asInteger(value);
    if (id != null && count != null && count >= 0) counts[id] = count;
  }
  return counts;
}

export function parseDateRange(raw: unknown): DateRange {
  const r = asRecord(raw);
  return {
    period: asPeriod(r.period) ?? DEFAULT_DATE_RANGE.period,
    offset: asInteger(r.offset) ?? DEFAULT_DATE_RANGE.offset,
    customStart: asIsoDate(r.customStart),
    customEnd: asIsoDate(r.customEnd),
    compare: typeof r.compare === 'boolean' ? r.compare : DEFAULT_DATE_RANGE.compare,
    compareCustomStart: asIsoDate(r.compareCustomStart),
    compareCustomEnd: asIsoDate(r.compareCustomEnd),
  };
}

export function parseDateRangeQuery(search: string): DateRange {
  const params = new URLSearchParams(search);
  return {
    period: asPeriod(params.get('range')) ?? DEFAULT_DATE_RANGE.period,
    offset: asInteger(parseInt(params.get('offset') ?? '', 10)) ?? DEFAULT_DATE_RANGE.offset,
    customStart: asIsoDate(params.get('rs')),
    customEnd: asIsoDate(params.get('re')),
    compare: params.get('cmp') === '1',
    compareCustomStart: asIsoDate(params.get('ccs')),
    compareCustomEnd: asIsoDate(params.get('cce')),
  };
}

export function parsePresetList(raw: unknown): PresetEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const r = asRecord(item);
    const id = asPositiveInteger(r.id);
    return id != null && typeof r.name === 'string' ? [{ id, name: r.name }] : [];
  });
}

export function parseTemplateList(raw: unknown): TemplateEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const { id, name, description, chartType } = asRecord(item);
    return typeof id === 'string' &&
      typeof name === 'string' &&
      typeof description === 'string' &&
      typeof chartType === 'string'
      ? [{ id, name, description, chartType }]
      : [];
  });
}
