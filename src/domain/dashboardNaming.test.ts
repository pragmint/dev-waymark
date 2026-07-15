import { describe, expect, test } from 'bun:test';
import { nextDashboardCopyName } from './dashboardNaming';

describe('nextDashboardCopyName', () => {
  test('produces copy1 for the first duplicate', () => {
    expect(nextDashboardCopyName([], 'Revenue overview')).toBe('copy1 - Revenue overview');
  });

  test('increments past existing copies of the same base name', () => {
    const existing = ['Revenue overview', 'copy1 - Revenue overview'];
    expect(nextDashboardCopyName(existing, 'Revenue overview')).toBe('copy2 - Revenue overview');
  });

  test('ignores copies of a differently named dashboard', () => {
    const existing = ['copy1 - Other dashboard', 'copy2 - Other dashboard'];
    expect(nextDashboardCopyName(existing, 'Revenue overview')).toBe('copy1 - Revenue overview');
  });

  test('duplicating a copy uses the original base name, not a stacked prefix', () => {
    const existing = ['Revenue overview', 'copy1 - Revenue overview'];
    expect(nextDashboardCopyName(existing, 'copy1 - Revenue overview')).toBe(
      'copy2 - Revenue overview'
    );
  });
});
