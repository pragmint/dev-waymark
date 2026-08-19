import { describe, test, expect } from 'bun:test';

// Pure logic: compute visibility state from data-has-results value
function computeButtonVisibility(dataHasResults: string | undefined): boolean {
  return dataHasResults === 'true';
}

describe('exportCsv visibility logic', () => {
  test('button is visible when data-has-results is "true"', () => {
    expect(computeButtonVisibility('true')).toBe(true);
  });

  test('button is hidden when data-has-results is "false"', () => {
    expect(computeButtonVisibility('false')).toBe(false);
  });

  test('button is hidden when data-has-results is undefined', () => {
    expect(computeButtonVisibility(undefined)).toBe(false);
  });

  test('button is hidden when data-has-results is any other value', () => {
    expect(computeButtonVisibility('maybe')).toBe(false);
    expect(computeButtonVisibility('')).toBe(false);
    expect(computeButtonVisibility('1')).toBe(false);
  });
});
