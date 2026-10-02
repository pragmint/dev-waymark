import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_DATE_RANGE,
  parseDashboardConfig,
  parseDateRange,
  parseDateRangeQuery,
  parsePresetList,
  parseTemplateList,
  parseVizDashboardCounts,
  parseVizIds,
  type DateRangeState,
} from './dashboardInputs';

describe('parseDashboardConfig', () => {
  it('keeps a positive integer id', () => {
    expect(parseDashboardConfig({ dashboardId: 42 })).toEqual({ dashboardId: 42 });
  });

  it('drops anything that is not a positive integer', () => {
    for (const dashboardId of [
      null,
      undefined,
      '42',
      'javascript:alert(1)',
      0,
      -1,
      1.5,
      NaN,
      [1],
    ]) {
      expect(parseDashboardConfig({ dashboardId })).toEqual({ dashboardId: null });
    }
  });

  it('tolerates a missing or malformed embed', () => {
    expect(parseDashboardConfig(null)).toEqual({ dashboardId: null });
    expect(parseDashboardConfig('42')).toEqual({ dashboardId: null });
  });
});

describe('parseVizIds', () => {
  it('keeps positive integers in order', () => {
    expect(parseVizIds([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('drops non-integer entries', () => {
    expect(parseVizIds([1, '2', null, 3.5, -4, 5])).toEqual([1, 5]);
  });

  it('returns empty for a non-array', () => {
    expect(parseVizIds({ 0: 1 })).toEqual([]);
    expect(parseVizIds(null)).toEqual([]);
  });
});

describe('parseVizDashboardCounts', () => {
  it('keeps integer-keyed, non-negative integer counts', () => {
    expect(parseVizDashboardCounts({ '1': 2, '7': 0 })).toEqual({ 1: 2, 7: 0 });
  });

  it('drops malformed keys and counts', () => {
    expect(parseVizDashboardCounts({ x: 1, '2': '3', '3': -1, '4': 1.5, '5': 1 })).toEqual({
      5: 1,
    });
  });

  it('returns empty for a non-object', () => {
    expect(parseVizDashboardCounts([1, 2])).toEqual({});
    expect(parseVizDashboardCounts(null)).toEqual({});
  });
});

describe('parseDateRange', () => {
  const full: DateRangeState = {
    period: 'custom',
    offset: 0,
    customStart: '2024-01-01',
    customEnd: '2024-01-31',
    compare: true,
    compareCustomStart: '2023-12-01',
    compareCustomEnd: '2023-12-31',
  };

  it('keeps a well-formed range', () => {
    expect(parseDateRange(full)).toEqual(full);
  });

  it('keeps a stepped period with an integer offset', () => {
    expect(parseDateRange({ ...DEFAULT_DATE_RANGE, period: 'month', offset: -2 })).toEqual({
      ...DEFAULT_DATE_RANGE,
      period: 'month',
      offset: -2,
    });
  });

  it('falls back field by field on malformed values', () => {
    expect(
      parseDateRange({
        period: 'decade',
        offset: '1;alert(1)',
        customStart: '01/02/2024',
        customEnd: 20240131,
        compare: 'yes',
        compareCustomStart: null,
      })
    ).toEqual(DEFAULT_DATE_RANGE);
  });

  it('rejects a fractional offset', () => {
    expect(parseDateRange({ period: 'week', offset: 0.5 }).offset).toBe(0);
  });

  it('returns the defaults for a missing embed', () => {
    expect(parseDateRange(null)).toEqual(DEFAULT_DATE_RANGE);
  });
});

describe('parseDateRangeQuery', () => {
  it('reads every range param', () => {
    expect(
      parseDateRangeQuery(
        '?range=custom&rs=2024-01-01&re=2024-01-31&cmp=1&ccs=2023-12-01&cce=2023-12-31'
      )
    ).toEqual({
      period: 'custom',
      offset: 0,
      customStart: '2024-01-01',
      customEnd: '2024-01-31',
      compare: true,
      compareCustomStart: '2023-12-01',
      compareCustomEnd: '2023-12-31',
    });
  });

  it('reads a stepped period and offset', () => {
    expect(parseDateRangeQuery('?range=quarter&offset=-3')).toEqual({
      ...DEFAULT_DATE_RANGE,
      period: 'quarter',
      offset: -3,
    });
  });

  it('falls back on malformed params', () => {
    expect(parseDateRangeQuery('?range=decade&offset=x&rs=yesterday&cmp=true')).toEqual(
      DEFAULT_DATE_RANGE
    );
  });

  it('returns the defaults for an empty query', () => {
    expect(parseDateRangeQuery('')).toEqual(DEFAULT_DATE_RANGE);
  });
});

describe('parsePresetList', () => {
  it('keeps entries with a positive integer id and a string name', () => {
    expect(
      parsePresetList([
        { id: 1, name: 'A' },
        { id: '2', name: 'B' },
        { id: 3, name: null },
        { id: 4, name: 'D', extra: true },
      ])
    ).toEqual([
      { id: 1, name: 'A' },
      { id: 4, name: 'D' },
    ]);
  });

  it('returns empty for a non-array', () => {
    expect(parsePresetList({ id: 1, name: 'A' })).toEqual([]);
  });
});

describe('parseTemplateList', () => {
  const template = { id: 'trend', name: 'Trend', description: 'Over time', chartType: 'line' };

  it('keeps entries whose fields are all strings', () => {
    expect(parseTemplateList([template, { ...template, chartType: 3 }])).toEqual([template]);
  });

  it('returns empty for a non-array', () => {
    expect(parseTemplateList(template)).toEqual([]);
  });
});
