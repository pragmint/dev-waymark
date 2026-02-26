import { describe, test, expect } from 'bun:test';
import { resolveChartType } from './mini-chart';
import type { ChartData } from './chart-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeData(dataArrays: (number | null)[][]): ChartData {
  return {
    labels: dataArrays[0]?.map((_, i) => `Label ${i}`) ?? [],
    datasets: dataArrays.map((data, i) => ({
      label: `Dataset ${i}`,
      data,
      borderColor: '#000',
      backgroundColor: '#fff',
    })),
  };
}

// ---------------------------------------------------------------------------
// resolveChartType
// ---------------------------------------------------------------------------

describe('resolveChartType', () => {
  test('returns "bar" when every dataset has exactly one data point', () => {
    // Arrange
    const data = makeData([[5], [3]]);

    // Act + Assert
    expect(resolveChartType(data)).toBe('bar');
  });

  test('returns "bar" when every dataset is empty', () => {
    // Arrange
    const data = makeData([[], []]);

    // Act + Assert
    expect(resolveChartType(data)).toBe('bar');
  });

  test('returns "bar" when there are no datasets', () => {
    // Arrange
    const data: ChartData = { labels: [], datasets: [] };

    // Act + Assert
    expect(resolveChartType(data)).toBe('bar');
  });

  test('returns "line" when any dataset has more than one data point', () => {
    // Arrange
    const data = makeData([[1, 2, 3]]);

    // Act + Assert
    expect(resolveChartType(data)).toBe('line');
  });

  test('returns "line" when at least one dataset has multiple points (mixed)', () => {
    // Arrange — one single-point, one multi-point
    const data = makeData([[5], [1, 2]]);

    // Act + Assert
    expect(resolveChartType(data)).toBe('line');
  });
});
