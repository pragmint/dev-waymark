import { describe, expect, test } from 'bun:test';
import {
  buildDateRangeFilters,
  computeDateRange,
  DEFAULT_DATE_RANGE,
  dateRangeToQueryParts,
  parseDateRangeFromQuery,
  resolveVizDateField,
} from './dateRange';
import type { VisualizationConfig } from '../schemas/visualization';

const NOW = new Date('2026-06-26T15:00:00Z'); // Friday, mid-Q2, mid-year

describe('parseDateRangeFromQuery', () => {
  test('returns defaults for empty params', () => {
    expect(parseDateRangeFromQuery(new URLSearchParams())).toEqual(DEFAULT_DATE_RANGE);
  });

  test('parses period and offset', () => {
    const p = parseDateRangeFromQuery(new URLSearchParams('range=month&offset=-2'));
    expect(p.period).toBe('month');
    expect(p.offset).toBe(-2);
  });

  test('parses custom dates', () => {
    const p = parseDateRangeFromQuery(
      new URLSearchParams('range=custom&rs=2026-01-01&re=2026-03-31')
    );
    expect(p.period).toBe('custom');
    expect(p.customStart).toBe('2026-01-01');
    expect(p.customEnd).toBe('2026-03-31');
  });

  test('rejects malformed date strings', () => {
    const p = parseDateRangeFromQuery(new URLSearchParams('range=custom&rs=garbage'));
    expect(p.customStart).toBeNull();
  });

  test('falls back to all when period unknown', () => {
    const p = parseDateRangeFromQuery(new URLSearchParams('range=foo'));
    expect(p.period).toBe('all');
  });
});

describe('dateRangeToQueryParts', () => {
  test('emits nothing at default', () => {
    expect(dateRangeToQueryParts(DEFAULT_DATE_RANGE)).toEqual([]);
  });

  test('emits range + offset when shifted', () => {
    expect(
      dateRangeToQueryParts({ period: 'month', offset: -1, customStart: null, customEnd: null })
    ).toEqual(['range=month', 'offset=-1']);
  });

  test('omits offset when zero', () => {
    expect(
      dateRangeToQueryParts({ period: 'month', offset: 0, customStart: null, customEnd: null })
    ).toEqual(['range=month']);
  });

  test('includes custom dates', () => {
    expect(
      dateRangeToQueryParts({
        period: 'custom',
        offset: 0,
        customStart: '2026-01-01',
        customEnd: '2026-03-31',
      })
    ).toEqual(['range=custom', 'rs=2026-01-01', 're=2026-03-31']);
  });
});

describe('computeDateRange', () => {
  test('all returns null bounds', () => {
    const c = computeDateRange(DEFAULT_DATE_RANGE, NOW);
    expect(c.start).toBeNull();
    expect(c.end).toBeNull();
    expect(c.label).toBe('All time');
  });

  test('month offset 0 spans June 2026', () => {
    const c = computeDateRange(
      { period: 'month', offset: 0, customStart: null, customEnd: null },
      NOW
    );
    expect(c.start!.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(c.end!.toISOString()).toBe('2026-06-30T23:59:59.999Z');
    expect(c.label).toBe('June 2026');
  });

  test('month offset -1 spans May 2026', () => {
    const c = computeDateRange(
      { period: 'month', offset: -1, customStart: null, customEnd: null },
      NOW
    );
    expect(c.start!.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(c.label).toBe('May 2026');
  });

  test('month offset crosses year boundary backwards', () => {
    const c = computeDateRange(
      { period: 'month', offset: -7, customStart: null, customEnd: null },
      NOW
    );
    expect(c.label).toBe('November 2025');
  });

  test('quarter offset 0 spans Q2 2026', () => {
    const c = computeDateRange(
      { period: 'quarter', offset: 0, customStart: null, customEnd: null },
      NOW
    );
    expect(c.start!.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(c.end!.toISOString()).toBe('2026-06-30T23:59:59.999Z');
    expect(c.label).toBe('Q2 2026');
  });

  test('quarter offset -3 wraps backwards across year', () => {
    const c = computeDateRange(
      { period: 'quarter', offset: -3, customStart: null, customEnd: null },
      NOW
    );
    expect(c.label).toBe('Q3 2025');
  });

  test('quarter offset +2 wraps forward across year', () => {
    const c = computeDateRange(
      { period: 'quarter', offset: 2, customStart: null, customEnd: null },
      NOW
    );
    expect(c.label).toBe('Q4 2026');
  });

  test('year offset 0', () => {
    const c = computeDateRange(
      { period: 'year', offset: 0, customStart: null, customEnd: null },
      NOW
    );
    expect(c.label).toBe('2026');
    expect(c.start!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(c.end!.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  test('week offset 0 starts on Monday', () => {
    const c = computeDateRange(
      { period: 'week', offset: 0, customStart: null, customEnd: null },
      NOW // Fri 2026-06-26
    );
    expect(c.start!.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(c.label).toBe('Week of Jun 22, 2026');
  });

  test('custom range with both bounds', () => {
    const c = computeDateRange(
      {
        period: 'custom',
        offset: 0,
        customStart: '2026-01-15',
        customEnd: '2026-02-20',
      },
      NOW
    );
    expect(c.start!.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(c.end!.toISOString()).toBe('2026-02-20T23:59:59.999Z');
    expect(c.label).toBe('Jan 15, 2026 – Feb 20, 2026');
  });

  test('custom range with only start', () => {
    const c = computeDateRange(
      { period: 'custom', offset: 0, customStart: '2026-01-15', customEnd: null },
      NOW
    );
    expect(c.start).not.toBeNull();
    expect(c.end).toBeNull();
    expect(c.label).toBe('From Jan 15, 2026');
  });
});

describe('resolveVizDateField', () => {
  test('prefers a date-typed xAxis', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'created_at', type: 'date', timeBucket: 'month' },
      aggregation: { function: 'count' },
    };
    expect(resolveVizDateField(config)).toBe('created_at');
  });

  test('falls back to derived metric start field', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'avg' },
      derivedMetric: {
        name: 'cycle time',
        type: 'duration',
        startMetadataKey: 'opened_at',
        endMetadataKey: 'merged_at',
        unit: 'hours',
      },
    };
    expect(resolveVizDateField(config)).toBe('opened_at');
  });

  test('returns null when neither is set', () => {
    const config: VisualizationConfig = {
      chartType: 'pie',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    expect(resolveVizDateField(config)).toBeNull();
  });
});

describe('buildDateRangeFilters', () => {
  test('emits gte+lte leaves', () => {
    const nodes = buildDateRangeFilters(
      {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T23:59:59.999Z'),
        label: 'June 2026',
      },
      'created_at'
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      type: 'filter',
      key: 'created_at',
      op: 'gte',
      value: '2026-06-01',
    });
    expect(nodes[1]).toMatchObject({
      type: 'filter',
      key: 'created_at',
      op: 'lte',
      value: '2026-06-30T23:59:59.999Z',
    });
  });

  test('emits nothing for unbounded range', () => {
    expect(
      buildDateRangeFilters({ start: null, end: null, label: 'All time' }, 'created_at')
    ).toEqual([]);
  });

  test('emits only gte when end is missing', () => {
    const nodes = buildDateRangeFilters(
      { start: new Date('2026-06-01T00:00:00Z'), end: null, label: 'From Jun 1' },
      'created_at'
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ op: 'gte' });
  });
});
