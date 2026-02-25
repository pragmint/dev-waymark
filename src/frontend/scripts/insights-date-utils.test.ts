import { describe, expect, it } from 'bun:test';
import {
  parseDataDate,
  dataDateToInputDate,
  inputDateToDataDate,
  formatDataDateForDisplay,
  parseDisplayDate,
  sortDisplayDates,
} from './insights-date-utils';

describe('insights-date-utils', () => {
  describe('parseDataDate', () => {
    it('parses date in dd.m.yyyy format', () => {
      const result = parseDataDate('27.1.2026');
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(0); // January = 0
      expect(result.getDate()).toBe(27);
    });
  });

  describe('dataDateToInputDate', () => {
    it('converts dd.m.yyyy to yyyy-mm-dd', () => {
      expect(dataDateToInputDate('27.1.2026')).toBe('2026-01-27');
      expect(dataDateToInputDate('5.12.2025')).toBe('2025-12-05');
    });
  });

  describe('inputDateToDataDate', () => {
    it('converts yyyy-mm-dd to dd.m.yyyy', () => {
      expect(inputDateToDataDate('2026-01-27')).toBe('27.1.2026');
      expect(inputDateToDataDate('2025-12-05')).toBe('5.12.2025');
    });

    it('returns empty string for empty input', () => {
      expect(inputDateToDataDate('')).toBe('');
    });
  });

  describe('formatDataDateForDisplay', () => {
    it('formats date in readable format', () => {
      const result = formatDataDateForDisplay('27.1.2026');
      expect(result).toBe('January 27, 2026');
    });
  });

  describe('parseDisplayDate', () => {
    it('parses display format date back to Date object', () => {
      const result = parseDisplayDate('January 27, 2026');
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(27);
    });
  });

  describe('sortDisplayDates', () => {
    it('sorts dates chronologically, not alphabetically', () => {
      const unsorted = ['March 10, 2026', 'January 27, 2026', 'February 14, 2026', 'April 1, 2026'];

      const sorted = sortDisplayDates(unsorted);

      expect(sorted).toEqual([
        'January 27, 2026',
        'February 14, 2026',
        'March 10, 2026',
        'April 1, 2026',
      ]);
    });

    it('handles dates across different years', () => {
      const unsorted = ['March 10, 2027', 'January 27, 2026', 'December 31, 2026'];

      const sorted = sortDisplayDates(unsorted);

      expect(sorted).toEqual(['January 27, 2026', 'December 31, 2026', 'March 10, 2027']);
    });

    it('does not mutate original array', () => {
      const original = ['March 10, 2026', 'January 27, 2026'];
      const copy = [...original];

      sortDisplayDates(original);

      expect(original).toEqual(copy);
    });
  });
});
