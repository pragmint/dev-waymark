// Utility functions for insights page - pure, testable functions
import { parseDataDate } from './insights-date-utils';

/**
 * Convert metric value to number, handling dimension scores and strings
 */
export function getNumericValue(value: number | string | Record<string, number>): number | null {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  if (typeof value === 'object' && value !== null) {
    const values = Object.values(value);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  return null;
}

/**
 * Filter data array by date range
 */
export function filterByDateRange<T extends { date: string }>(
  data: T[],
  startDate: string,
  endDate: string
): T[] {
  if (!startDate || !endDate) return data;

  const start = parseDataDate(startDate);
  const end = parseDataDate(endDate);

  return data.filter(point => {
    const pointDate = parseDataDate(point.date);
    return pointDate >= start && pointDate <= end;
  });
}

/**
 * Sort data by date ascending
 */
export function sortByDate<T extends { date: string }>(data: T[]): T[] {
  return [...data].sort(
    (a, b) => parseDataDate(a.date).getTime() - parseDataDate(b.date).getTime()
  );
}
