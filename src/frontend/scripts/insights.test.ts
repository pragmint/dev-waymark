import { describe, test, expect } from 'bun:test';
import {
  findMetric,
  getMetricLabel,
  isCapabilityMetric,
  type MetricsData,
} from './insights-metric-utils';

describe('findMetric', () => {
  const mockMetricsData: MetricsData = {
    availableDates: ['1.1.2025', '2.1.2025'],
    teams: [
      { id: 'team-a', name: 'Team A' },
      { id: 'team-b', name: 'Team B' },
    ],
    metricOptions: [],
    capabilityMetrics: [
      {
        capabilityId: 'ci-cd',
        data: [
          { team: 'team-a', date: '1.1.2025', value: 3 },
          { team: 'team-b', date: '1.1.2025', value: 2 },
        ],
      },
      {
        capabilityId: 'test-automation',
        data: [{ team: 'team-a', date: '1.1.2025', value: 4 }],
      },
    ],
    teamMetrics: [
      {
        teamId: 'team-a',
        metricName: 'deployment-frequency',
        data: [{ date: '1.1.2025', value: 10 }],
      },
      {
        teamId: 'team-b',
        metricName: 'lead-time',
        data: [{ date: '1.1.2025', value: 5 }],
      },
    ],
  };

  test('finds capability metric by ID', () => {
    const result = findMetric('ci-cd', mockMetricsData);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('capability');
    if (result?.type === 'capability') {
      expect(result.metric.capabilityId).toBe('ci-cd');
      expect(result.metric.data).toHaveLength(2);
    }
  });

  test('finds another capability metric by ID', () => {
    const result = findMetric('test-automation', mockMetricsData);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('capability');
    if (result?.type === 'capability') {
      expect(result.metric.capabilityId).toBe('test-automation');
      expect(result.metric.data).toHaveLength(1);
    }
  });

  test('finds team-specific metric by composite ID (teamId:metricName)', () => {
    const result = findMetric('team-a:deployment-frequency', mockMetricsData);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('team');
    if (result?.type === 'team') {
      expect(result.metric.teamId).toBe('team-a');
      expect(result.metric.metricName).toBe('deployment-frequency');
      expect(result.metric.data).toHaveLength(1);
    }
  });

  test('finds another team-specific metric by composite ID', () => {
    const result = findMetric('team-b:lead-time', mockMetricsData);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('team');
    if (result?.type === 'team') {
      expect(result.metric.teamId).toBe('team-b');
      expect(result.metric.metricName).toBe('lead-time');
    }
  });

  test('returns null for non-existent capability metric', () => {
    const result = findMetric('non-existent', mockMetricsData);

    expect(result).toBeNull();
  });

  test('returns null for non-existent team metric', () => {
    const result = findMetric('team-c:unknown-metric', mockMetricsData);

    expect(result).toBeNull();
  });

  test('returns null for malformed team metric ID (team exists but metric does not)', () => {
    const result = findMetric('team-a:unknown-metric', mockMetricsData);

    expect(result).toBeNull();
  });

  test('handles empty metrics data', () => {
    const emptyData: MetricsData = {
      availableDates: [],
      teams: [],
      metricOptions: [],
      capabilityMetrics: [],
      teamMetrics: [],
    };

    expect(findMetric('ci-cd', emptyData)).toBeNull();
    expect(findMetric('team-a:deployment-frequency', emptyData)).toBeNull();
  });
});

describe('getMetricLabel', () => {
  const mockMetricOptions = [
    { id: 'ci-cd', label: 'CI/CD', type: 'capability' as const },
    { id: 'test-automation', label: 'Test Automation', type: 'capability' as const },
    {
      id: 'team-a:deployment-frequency',
      label: 'Team A - Deployment Frequency',
      type: 'team-specific' as const,
      teamId: 'team-a',
    },
    {
      id: 'team-b:lead-time',
      label: 'Team B - Lead Time',
      type: 'team-specific' as const,
      teamId: 'team-b',
    },
  ];

  test('returns label for existing capability metric', () => {
    const label = getMetricLabel('ci-cd', mockMetricOptions);

    expect(label).toBe('CI/CD');
  });

  test('returns label for another existing capability metric', () => {
    const label = getMetricLabel('test-automation', mockMetricOptions);

    expect(label).toBe('Test Automation');
  });

  test('returns label for team-specific metric', () => {
    const label = getMetricLabel('team-a:deployment-frequency', mockMetricOptions);

    expect(label).toBe('Team A - Deployment Frequency');
  });

  test('returns label for another team-specific metric', () => {
    const label = getMetricLabel('team-b:lead-time', mockMetricOptions);

    expect(label).toBe('Team B - Lead Time');
  });

  test('returns metric ID as fallback when not found', () => {
    const label = getMetricLabel('non-existent', mockMetricOptions);

    expect(label).toBe('non-existent');
  });

  test('returns metric ID as fallback for empty options', () => {
    const label = getMetricLabel('ci-cd', []);

    expect(label).toBe('ci-cd');
  });
});

describe('isCapabilityMetric', () => {
  test('returns true for capability metric ID (no colon)', () => {
    expect(isCapabilityMetric('ci-cd')).toBe(true);
  });

  test('returns true for another capability metric ID', () => {
    expect(isCapabilityMetric('test-automation')).toBe(true);
  });

  test('returns true for capability metric with hyphens', () => {
    expect(isCapabilityMetric('code-maintainability')).toBe(true);
  });

  test('returns false for team-specific metric ID (contains colon)', () => {
    expect(isCapabilityMetric('team-a:deployment-frequency')).toBe(false);
  });

  test('returns false for another team-specific metric ID', () => {
    expect(isCapabilityMetric('team-b:lead-time')).toBe(false);
  });

  test('returns false for metric ID with multiple colons', () => {
    expect(isCapabilityMetric('team:metric:extra')).toBe(false);
  });

  test('returns true for empty string (edge case)', () => {
    expect(isCapabilityMetric('')).toBe(true);
  });
});
