import { describe, expect, it } from 'bun:test';
import { parseDate, formatDate } from './parseDate';

describe('parseDate', () => {
  it('returns null for null input', () => {
    expect(parseDate(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseDate(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseDate('')).toBeNull();
  });

  it('returns null for a non-date string', () => {
    expect(parseDate('not a date')).toBeNull();
  });

  it('parses a YYYY-MM-DD string', () => {
    const date = parseDate('2024-03-15');
    expect(date).not.toBeNull();
    expect(date?.getUTCFullYear()).toBe(2024);
    expect(date?.getUTCMonth()).toBe(2);
    expect(date?.getUTCDate()).toBe(15);
  });

  it('parses a full ISO 8601 string', () => {
    const date = parseDate('2024-03-15T12:34:56Z');
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2024-03-15T12:34:56.000Z');
  });

  it('parses a leap day', () => {
    const date = parseDate('2024-02-29');
    expect(date).not.toBeNull();
    expect(date?.getUTCMonth()).toBe(1);
    expect(date?.getUTCDate()).toBe(29);
  });

  it('rolls an out-of-range day forward via the Date constructor', () => {
    // Documents JS Date behavior: '2023-02-29' is not rejected — it becomes March 1, 2023.
    const date = parseDate('2023-02-29');
    expect(date).not.toBeNull();
    expect(date?.toISOString().slice(0, 10)).toBe('2023-03-01');
  });

  it('returns null for a malformed ISO string', () => {
    expect(parseDate('2024-13-99')).toBeNull();
  });
});

describe('formatDate', () => {
  it('returns an em dash for null input', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('returns an em dash for undefined input', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('returns an em dash for an empty string', () => {
    expect(formatDate('')).toBe('—');
  });

  it('returns an em dash for an unparseable string', () => {
    expect(formatDate('not a date')).toBe('—');
  });

  it('formats a valid date as "Mon D, YYYY"', () => {
    expect(formatDate('2024-03-15T12:00:00Z')).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2024$/);
  });

  it('includes the correct year for a valid date', () => {
    expect(formatDate('2024-03-15T12:00:00Z')).toContain('2024');
  });
});
