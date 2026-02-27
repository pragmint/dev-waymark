import { describe, it, expect } from 'bun:test';
import {
  transformTeamMetricData,
  transformCapabilityMetricData,
  mergeChartDataForComparison,
  teamIdToName,
  type TeamMetric,
  type CapabilityMetric,
  type TeamInfo,
} from './insights-data';

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function makeTeamInfo(): TeamInfo[] {
  return [
    { id: 'team-a', name: 'Team Alpha' },
    { id: 'team-b', name: 'Team Beta' },
    { id: 'team-c', name: 'Team Gamma' },
  ];
}

function makeNumericTeamMetric(): TeamMetric {
  return {
    teamId: 'team-a',
    metricName: 'velocity',
    data: [
      { date: '1.1.2026', value: 10 },
      { date: '2.1.2026', value: 15 },
      { date: '3.1.2026', value: 20 },
    ],
  };
}

function makeQualitativeTeamMetric(): TeamMetric {
  return {
    teamId: 'team-a',
    metricName: 'anecdotes',
    data: [
      { date: '1.1.2026', value: 'Things are going well' },
      { date: '2.1.2026', value: 'Had some challenges today' },
    ],
  };
}

function makeCapabilityMetric(): CapabilityMetric {
  return {
    capabilityId: 'test-automation',
    data: [
      { team: 'team-a', date: '1.1.2026', value: 1 },
      { team: 'team-b', date: '1.1.2026', value: 2 },
      { team: 'team-a', date: '2.1.2026', value: 2 },
      { team: 'team-b', date: '2.1.2026', value: 3 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests for teamIdToName
// ---------------------------------------------------------------------------

describe('teamIdToName', () => {
  it('returns the team name when team exists', () => {
    const teams = makeTeamInfo();
    expect(teamIdToName('team-a', teams)).toBe('Team Alpha');
    expect(teamIdToName('team-b', teams)).toBe('Team Beta');
  });

  it('returns the team ID when team does not exist', () => {
    const teams = makeTeamInfo();
    expect(teamIdToName('team-unknown', teams)).toBe('team-unknown');
  });

  it('returns the team ID when teams array is empty', () => {
    expect(teamIdToName('team-a', [])).toBe('team-a');
  });
});

// ---------------------------------------------------------------------------
// Tests for transformTeamMetricData
// ---------------------------------------------------------------------------

describe('transformTeamMetricData', () => {
  const teams = makeTeamInfo();

  it('transforms numeric team metric data into chart format', () => {
    const metric = makeNumericTeamMetric();
    const result = transformTeamMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result.labels).toEqual(['January 1, 2026', 'January 2, 2026', 'January 3, 2026']);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].label).toBe('Team Alpha - velocity');
    expect(result.datasets[0].data).toEqual([10, 15, 20]);
    expect(result.qualitativeData).toBeUndefined();
  });

  it('filters data by date range', () => {
    const metric = makeNumericTeamMetric();
    const result = transformTeamMetricData(metric, '2.1.2026', '2.1.2026', teams);

    expect(result.labels).toEqual(['January 2, 2026']);
    expect(result.datasets[0].data).toEqual([15]);
  });

  it('handles qualitative metrics by creating a single count bar chart dataset', () => {
    const metric = makeQualitativeTeamMetric();
    const result = transformTeamMetricData(metric, '1.1.2026', '31.12.2026', teams);

    // Should create a single dataset with the metric name as label
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].label).toBe('anecdotes');

    // Each value is the count of entries on that date
    expect(result.datasets[0].data).toEqual([1, 1]);

    // Metadata should contain the anecdote text per date
    expect(result.datasets[0].metadata![0]!.anecdotes).toBe(' • Things are going well');
    expect(result.datasets[0].metadata![1]!.anecdotes).toBe(' • Had some challenges today');

    // qualitativeData is preserved to mark the metric type
    expect(result.qualitativeData).toBeDefined();
    expect(result.qualitativeData).toHaveLength(2);
    expect(result.qualitativeData![0].value).toBe('Things are going well');
    expect(result.qualitativeData![0].date).toBe('1.1.2026');
  });

  it('includes metadata in dataset when present', () => {
    const metricWithMetadata: TeamMetric = {
      teamId: 'team-a',
      metricName: 'velocity',
      data: [
        { date: '1.1.2026', value: 10, justification: 'Sprint was short' },
        { date: '2.1.2026', value: 15 },
      ],
    };

    const result = transformTeamMetricData(metricWithMetadata, '1.1.2026', '31.12.2026', teams);

    expect(result.datasets[0].metadata).toBeDefined();
    expect(result.datasets[0].metadata![0]).toEqual({ justification: 'Sprint was short' });
    expect(result.datasets[0].metadata![1]).toBeUndefined();
  });

  it('stores anecdote text and preserves qualitativeData metadata', () => {
    const metricWithMetadata: TeamMetric = {
      teamId: 'team-a',
      metricName: 'anecdotes',
      data: [
        { date: '1.1.2026', value: 'Good day', link: 'https://example.com' },
        { date: '2.1.2026', value: 'Bad day' },
      ],
    };

    const result = transformTeamMetricData(metricWithMetadata, '1.1.2026', '31.12.2026', teams);

    // Single dataset; metadata contains the entry text as `anecdotes`
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].metadata![0]).toEqual({ anecdotes: ' • Good day' });
    expect(result.datasets[0].metadata![1]).toEqual({ anecdotes: ' • Bad day' });

    // qualitativeData preserves per-entry metadata (including extra fields like link)
    expect(result.qualitativeData![0].metadata).toEqual({ link: 'https://example.com' });
    expect(result.qualitativeData![1].metadata).toBeUndefined();
  });

  it('combines multiple anecdotes on the same date with a blank line separator', () => {
    const metric: TeamMetric = {
      teamId: 'team-a',
      metricName: 'anecdotes',
      data: [
        { date: '1.1.2026', value: 'First entry' },
        { date: '1.1.2026', value: 'Second entry' },
        { date: '2.1.2026', value: 'Solo entry' },
      ],
    };

    const result = transformTeamMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result.datasets[0].data).toEqual([2, 1]);
    expect(result.datasets[0].metadata![0]!.anecdotes).toBe(' • First entry\n\n • Second entry');
    expect(result.datasets[0].metadata![1]!.anecdotes).toBe(' • Solo entry');
  });

  it('returns empty datasets when no data matches date range', () => {
    const metric = makeNumericTeamMetric();
    const result = transformTeamMetricData(metric, '1.6.2026', '30.6.2026', teams);

    expect(result.labels).toEqual([]);
    expect(result.datasets[0].data).toEqual([]);
  });

  it('sorts data by date', () => {
    const metric: TeamMetric = {
      teamId: 'team-a',
      metricName: 'velocity',
      data: [
        { date: '3.1.2026', value: 30 },
        { date: '1.1.2026', value: 10 },
        { date: '2.1.2026', value: 20 },
      ],
    };

    const result = transformTeamMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result.datasets[0].data).toEqual([10, 20, 30]);
  });
});

// ---------------------------------------------------------------------------
// Tests for transformCapabilityMetricData
// ---------------------------------------------------------------------------

describe('transformCapabilityMetricData', () => {
  const teams = makeTeamInfo();

  it('transforms capability metric data into chart format grouped by team', () => {
    const metric = makeCapabilityMetric();
    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result).not.toBeNull();
    expect(result!.labels).toEqual(['January 1, 2026', 'January 2, 2026']);
    expect(result!.datasets).toHaveLength(2);
    expect(result!.datasets[0].label).toBe('Team Alpha');
    expect(result!.datasets[1].label).toBe('Team Beta');
  });

  it('aligns data points by date with null for missing values', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'ci',
      data: [
        { team: 'team-a', date: '1.1.2026', value: 1 },
        { team: 'team-b', date: '2.1.2026', value: 2 },
        { team: 'team-a', date: '3.1.2026', value: 3 },
      ],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result!.datasets[0].data).toEqual([1, null, 3]);
    expect(result!.datasets[1].data).toEqual([null, 2, null]);
  });

  it('returns null when no data matches date range', () => {
    const metric = makeCapabilityMetric();
    const result = transformCapabilityMetricData(metric, '1.6.2026', '30.6.2026', teams);

    expect(result).toBeNull();
  });

  it('returns null when data array is empty', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'test',
      data: [],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result).toBeNull();
  });

  it('handles teams without team field using "unknown"', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'test',
      data: [{ date: '1.1.2026', value: 1 }],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result!.datasets[0].label).toBe('unknown');
  });

  it('includes metadata in datasets', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'test',
      data: [
        {
          team: 'team-a',
          date: '1.1.2026',
          value: 1,
          justification: 'Good progress',
          link: 'https://example.com',
        },
        { team: 'team-a', date: '2.1.2026', value: 2 },
      ],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result!.datasets[0].metadata).toBeDefined();
    expect(result!.datasets[0].metadata![0]).toEqual({
      justification: 'Good progress',
      link: 'https://example.com',
    });
    expect(result!.datasets[0].metadata![1]).toBeUndefined();
  });

  it('flattens dimension justifications into metadata', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'test',
      data: [
        {
          team: 'team-a',
          date: '1.1.2026',
          value: { 'new-code': 1, 'old-code': 2 },
          dimensionJustifications: {
            'new-code': 'Good test coverage',
            'old-code': 'Legacy code needs work',
          },
        },
      ],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result!.datasets[0].metadata![0]).toEqual({
      'new-code_justification': 'Good test coverage',
      'old-code_justification': 'Legacy code needs work',
    });
  });

  it('sorts dates chronologically', () => {
    const metric: CapabilityMetric = {
      capabilityId: 'test',
      data: [
        { team: 'team-a', date: '3.1.2026', value: 3 },
        { team: 'team-a', date: '1.1.2026', value: 1 },
        { team: 'team-a', date: '2.1.2026', value: 2 },
      ],
    };

    const result = transformCapabilityMetricData(metric, '1.1.2026', '31.12.2026', teams);

    expect(result!.datasets[0].data).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Tests for mergeChartDataForComparison
// ---------------------------------------------------------------------------

describe('mergeChartDataForComparison', () => {
  function makeSimpleChartData() {
    return {
      labels: ['January 1, 2026', 'January 2, 2026'],
      datasets: [
        {
          label: 'Metric A',
          data: [10, 20],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
        },
      ],
    };
  }

  it('merges two chart datasets with aligned dates', () => {
    const data1 = makeSimpleChartData();
    const data2 = {
      labels: ['January 1, 2026', 'January 2, 2026'],
      datasets: [
        {
          label: 'Metric B',
          data: [5, 15],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    expect(result).not.toBeNull();
    expect(result!.labels).toEqual(['January 1, 2026', 'January 2, 2026']);
    expect(result!.datasets).toHaveLength(2);
    expect(result!.datasets[0].yAxisID).toBe('y');
    expect(result!.datasets[1].yAxisID).toBe('y1');
  });

  it('returns null when data1 is null', () => {
    const data2 = makeSimpleChartData();
    const result = mergeChartDataForComparison(null as unknown as never, data2);

    expect(result).toBeNull();
  });

  it('returns null when data2 is null', () => {
    const data1 = makeSimpleChartData();
    const result = mergeChartDataForComparison(data1, null as unknown as never);

    expect(result).toBeNull();
  });

  it('merges qualitative data with numeric data for combo charts', () => {
    const qualitativeData = {
      labels: ['January 1, 2026'],
      datasets: [
        {
          label: 'anecdotes',
          data: [2],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          metadata: [{ anecdotes: 'Entry one\n\nEntry two' }],
        },
      ],
      qualitativeData: [{ date: '1.1.2026', value: 'Entry one' }],
    };
    const numericData = makeSimpleChartData();

    const result = mergeChartDataForComparison(qualitativeData, numericData);

    expect(result).not.toBeNull();
    expect(result!.labels).toEqual(['January 1, 2026', 'January 2, 2026']);
    expect(result!.datasets[0].yAxisID).toBe('y');
    expect(result!.datasets[1].yAxisID).toBe('y1');
  });

  it('aligns dates with nulls for missing data points', () => {
    const data1 = {
      labels: ['January 1, 2026', 'January 3, 2026'],
      datasets: [
        {
          label: 'Metric A',
          data: [10, 30],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
        },
      ],
    };

    const data2 = {
      labels: ['January 2, 2026', 'January 3, 2026'],
      datasets: [
        {
          label: 'Metric B',
          data: [20, 30],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    expect(result!.labels).toEqual(['January 1, 2026', 'January 2, 2026', 'January 3, 2026']);
    expect(result!.datasets[0].data).toEqual([10, null, 30]);
    expect(result!.datasets[1].data).toEqual([null, 20, 30]);
  });

  it('preserves metadata from both datasets', () => {
    const data1 = {
      labels: ['January 1, 2026'],
      datasets: [
        {
          label: 'A',
          data: [10],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          metadata: [{ justification: 'Test A' }],
        },
      ],
    };

    const data2 = {
      labels: ['January 1, 2026'],
      datasets: [
        {
          label: 'B',
          data: [20],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          metadata: [{ justification: 'Test B' }],
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    expect(result!.datasets[0].metadata![0]).toEqual({ justification: 'Test A' });
    expect(result!.datasets[1].metadata![0]).toEqual({ justification: 'Test B' });
  });

  it('aligns metadata with nulls when dates differ', () => {
    const data1 = {
      labels: ['January 1, 2026', 'January 2, 2026'],
      datasets: [
        {
          label: 'A',
          data: [10, 20],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          metadata: [{ note: 'First' }, { note: 'Second' }],
        },
      ],
    };

    const data2 = {
      labels: ['January 2, 2026', 'January 3, 2026'],
      datasets: [
        {
          label: 'B',
          data: [25, 30],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          metadata: [{ note: 'Alpha' }, { note: 'Beta' }],
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    // Result labels: [Jan 1, Jan 2, Jan 3]
    // data1 metadata: [First, Second, undefined]
    // data2 metadata: [undefined, Alpha, Beta]
    expect(result!.datasets[0].metadata).toEqual([
      { note: 'First' },
      { note: 'Second' },
      undefined,
    ]);
    expect(result!.datasets[1].metadata).toEqual([undefined, { note: 'Alpha' }, { note: 'Beta' }]);
  });

  it('handles datasets without metadata', () => {
    const data1 = makeSimpleChartData();
    const data2 = makeSimpleChartData();

    const result = mergeChartDataForComparison(data1, data2);

    expect(result!.datasets[0].metadata).toBeUndefined();
    expect(result!.datasets[1].metadata).toBeUndefined();
  });

  it('uses different colors for second metric datasets', () => {
    const data1 = {
      labels: ['January 1, 2026'],
      datasets: [
        {
          label: 'A1',
          data: [10],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
        },
        {
          label: 'A2',
          data: [15],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
        },
      ],
    };

    const data2 = {
      labels: ['January 1, 2026'],
      datasets: [
        {
          label: 'B1',
          data: [20],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    // First metric keeps original colors (indices 0, 1)
    // Second metric gets offset colors (starting at index 2)
    expect(result!.datasets[2].borderColor).toBe('rgb(54, 162, 235)');
    expect(result!.datasets[2].backgroundColor).toBe('rgba(54, 162, 235, 0.2)');
  });

  it('sorts merged labels chronologically', () => {
    const data1 = {
      labels: ['January 3, 2026', 'January 1, 2026'],
      datasets: [
        {
          label: 'A',
          data: [30, 10],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
        },
      ],
    };

    const data2 = {
      labels: ['January 2, 2026'],
      datasets: [
        {
          label: 'B',
          data: [20],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
        },
      ],
    };

    const result = mergeChartDataForComparison(data1, data2);

    expect(result!.labels).toEqual(['January 1, 2026', 'January 2, 2026', 'January 3, 2026']);
  });
});
