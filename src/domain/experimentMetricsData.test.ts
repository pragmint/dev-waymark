import { describe, test, expect } from 'bun:test';
import {
  buildCapabilityChartData,
  buildTeamMetricChartData,
  resolveMetricChartData,
} from './experimentMetricsData';
import type { CapabilityMetric } from '../frontend/scripts/insights-data';
import type { TeamMetric } from '../schemas/metricSchemas';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeCapabilityMetric(
  capabilityId: string,
  points: { team: string; date: string; value: number }[]
): CapabilityMetric {
  return { capabilityId, data: points };
}

function makeTeamMetric(
  teamId: string,
  metricName: string,
  points: { date: string; value: number }[]
): TeamMetric {
  return { teamId, metricName, data: points };
}

// ---------------------------------------------------------------------------
// buildCapabilityChartData
// ---------------------------------------------------------------------------

describe('buildCapabilityChartData', () => {
  test('returns null when no data points belong to the given teamId', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', [{ team: 'team-b', date: '1.1.2026', value: 3 }]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert
    expect(result).toBeNull();
  });

  test('returns null when the metric has no data at all', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', []);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert
    expect(result).toBeNull();
  });

  test('filters to only the matching team', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', [
      { team: 'team-a', date: '1.1.2026', value: 3 },
      { team: 'team-b', date: '1.1.2026', value: 5 },
    ]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert
    expect(result).not.toBeNull();
    expect(result!.datasets[0].data).toEqual([3]);
  });

  test('sorts data points chronologically', () => {
    // Arrange — points are intentionally out of order
    const metric = makeCapabilityMetric('ci', [
      { team: 'team-a', date: '1.3.2026', value: 3 },
      { team: 'team-a', date: '1.1.2026', value: 1 },
      { team: 'team-a', date: '1.2.2026', value: 2 },
    ]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert — data must be in ascending date order
    expect(result!.datasets[0].data).toEqual([1, 2, 3]);
    expect(result!.labels).toHaveLength(3);
  });

  test('uses teamName as the dataset label', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', [{ team: 'team-a', date: '1.1.2026', value: 4 }]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team Alpha');

    // Assert
    expect(result!.datasets[0].label).toBe('Team Alpha');
  });

  test('produces one dataset', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', [{ team: 'team-a', date: '1.1.2026', value: 2 }]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert
    expect(result!.datasets).toHaveLength(1);
  });

  test('produces the same number of labels as data points', () => {
    // Arrange
    const metric = makeCapabilityMetric('ci', [
      { team: 'team-a', date: '1.1.2026', value: 1 },
      { team: 'team-a', date: '1.2.2026', value: 2 },
    ]);

    // Act
    const result = buildCapabilityChartData(metric, 'team-a', 'Team A');

    // Assert
    expect(result!.labels).toHaveLength(result!.datasets[0].data.length);
  });
});

// ---------------------------------------------------------------------------
// buildTeamMetricChartData
// ---------------------------------------------------------------------------

describe('buildTeamMetricChartData', () => {
  test('returns null when data array is empty', () => {
    // Arrange
    const metric = makeTeamMetric('team-a', 'linter-errors', []);

    // Act
    const result = buildTeamMetricChartData(metric, 'Team A');

    // Assert
    expect(result).toBeNull();
  });

  test('sorts data points chronologically', () => {
    // Arrange — points are intentionally out of order
    const metric = makeTeamMetric('team-a', 'linter-errors', [
      { date: '1.3.2026', value: 30 },
      { date: '1.1.2026', value: 10 },
      { date: '1.2.2026', value: 20 },
    ]);

    // Act
    const result = buildTeamMetricChartData(metric, 'Team A');

    // Assert
    expect(result!.datasets[0].data).toEqual([10, 20, 30]);
  });

  test('uses teamName as the dataset label', () => {
    // Arrange
    const metric = makeTeamMetric('team-a', 'linter-errors', [{ date: '1.1.2026', value: 5 }]);

    // Act
    const result = buildTeamMetricChartData(metric, 'Team Bravo');

    // Assert
    expect(result!.datasets[0].label).toBe('Team Bravo');
  });

  test('produces one dataset with one label per data point', () => {
    // Arrange
    const metric = makeTeamMetric('team-a', 'linter-errors', [
      { date: '1.1.2026', value: 1 },
      { date: '1.2.2026', value: 2 },
      { date: '1.3.2026', value: 3 },
    ]);

    // Act
    const result = buildTeamMetricChartData(metric, 'Team A');

    // Assert
    expect(result!.datasets).toHaveLength(1);
    expect(result!.labels).toHaveLength(3);
    expect(result!.datasets[0].data).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// resolveMetricChartData
// ---------------------------------------------------------------------------

describe('resolveMetricChartData', () => {
  test('returns capability chart data when a matching capability metric is found', () => {
    // Arrange
    const capMetrics = [
      makeCapabilityMetric('ci', [{ team: 'team-a', date: '1.1.2026', value: 3 }]),
    ];
    const tmMetrics: TeamMetric[] = [];

    // Act
    const result = resolveMetricChartData('ci', 'team-a', 'Team A', capMetrics, tmMetrics);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.datasets[0].data).toEqual([3]);
  });

  test('falls through to team metric when capability metric has no data for the team', () => {
    // Arrange — capability metric exists but only has data for team-b
    const capMetrics = [
      makeCapabilityMetric('ci', [{ team: 'team-b', date: '1.1.2026', value: 5 }]),
    ];
    const tmMetrics = [makeTeamMetric('team-a', 'ci', [{ date: '1.1.2026', value: 7 }])];

    // Act
    const result = resolveMetricChartData('ci', 'team-a', 'Team A', capMetrics, tmMetrics);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.datasets[0].data).toEqual([7]);
  });

  test('returns team metric data when no matching capability metric exists', () => {
    // Arrange
    const capMetrics: CapabilityMetric[] = [];
    const tmMetrics = [
      makeTeamMetric('team-a', 'linter-errors', [{ date: '1.1.2026', value: 42 }]),
    ];

    // Act
    const result = resolveMetricChartData(
      'linter-errors',
      'team-a',
      'Team A',
      capMetrics,
      tmMetrics
    );

    // Assert
    expect(result).not.toBeNull();
    expect(result!.datasets[0].data).toEqual([42]);
  });

  test('returns null when neither capability nor team metric is found', () => {
    // Arrange
    const capMetrics: CapabilityMetric[] = [];
    const tmMetrics: TeamMetric[] = [];

    // Act
    const result = resolveMetricChartData(
      'unknown-metric',
      'team-a',
      'Team A',
      capMetrics,
      tmMetrics
    );

    // Assert
    expect(result).toBeNull();
  });

  test('returns null when capability metric found but team metric not found for fallback', () => {
    // Arrange — capability metric has no data for team-a; no team metric either
    const capMetrics = [
      makeCapabilityMetric('ci', [{ team: 'team-b', date: '1.1.2026', value: 5 }]),
    ];
    const tmMetrics: TeamMetric[] = [];

    // Act
    const result = resolveMetricChartData('ci', 'team-a', 'Team A', capMetrics, tmMetrics);

    // Assert
    expect(result).toBeNull();
  });
});
