import { describe, test, expect } from 'bun:test';
import { enrichTeamsWithMetrics, enrichCapabilitiesWithMetrics } from './metricAggregations';
import type { Metric } from '../parsers/yaml/metricParser';
import type { Team } from './teamTypes';
import type { Capability } from './capabilityTypes';

describe('Metric Aggregations - Multiple Submissions', () => {
  test('enrichTeamsWithMetrics uses most recent date for team with multiple submissions', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 1 },
          { team: 'team-a', date: '28.1.2026', value: 2 },
          { team: 'team-a', date: '26.1.2026', value: 0 },
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    // Should use the most recent date (28.1.2026) with value 2
    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(2);
  });

  test('enrichTeamsWithMetrics calculates trend from value difference between two most recent dates', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '26.1.2026', value: 1 },
          { team: 'team-a', date: '27.1.2026', value: 2 },
          { team: 'team-a', date: '28.1.2026', value: 3 }, // Most recent, increased
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    // Trend should be 'up' (3 - 2 = 1 > 0)
    expect(enriched[0].targetedCapabilities[0].trend).toBe('up');
    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(3);
  });

  test('enrichTeamsWithMetrics handles dates with single-digit days correctly', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '9.1.2026', value: 1 }, // Day 9
          { team: 'team-a', date: '10.1.2026', value: 2 }, // Day 10 - should be most recent
          { team: 'team-a', date: '8.1.2026', value: 0 }, // Day 8
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    // Should correctly identify 10.1.2026 as most recent (not 9.1.2026 via lexicographic sort)
    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(2);
    expect(enriched[0].targetedCapabilities[0].trend).toBe('up'); // 2 - 1 = 1 > 0
  });

  test('enrichTeamsWithMetrics calculates down trend when value decreases', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 3 },
          { team: 'team-a', date: '28.1.2026', value: 1 }, // Decreased
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(1);
    expect(enriched[0].targetedCapabilities[0].trend).toBe('down'); // 1 - 3 = -2 < 0
  });

  test('enrichTeamsWithMetrics shows stable trend when value unchanged', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 2 },
          { team: 'team-a', date: '28.1.2026', value: 2 }, // Same value
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(2);
    expect(enriched[0].targetedCapabilities[0].trend).toBe('stable'); // 2 - 2 = 0
  });

  test('enrichCapabilitiesWithMetrics uses most recent value from each team', () => {
    const capabilities: Capability[] = [
      {
        id: 'cap-1',
        name: 'Test Capability',
        currentScore: 0,
        trend: 'stable',
        teamsTargeting: 0,
      },
    ];

    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
      {
        id: 'team-b',
        name: 'Team B',
        targetedCapabilities: [],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 2 },
          { team: 'team-b', date: '27.1.2026', value: 4 },
          { team: 'team-a', date: '28.1.2026', value: 3 }, // Most recent for team-a
          { team: 'team-b', date: '28.1.2026', value: 3 }, // Most recent for team-b
        ],
      },
    ];

    const enriched = enrichCapabilitiesWithMetrics(capabilities, metrics, teams);

    // Average of each team's most recent value: (3 + 3) / 2 = 3
    expect(enriched[0].currentScore).toBe(3);
    // Trend: current avg (3) vs previous avg ((2+4)/2 = 3), diff = 0, so stable
    expect(enriched[0].trend).toBe('stable');
  });

  test('enrichCapabilitiesWithMetrics averages each team most recent value even when submitted on different dates', () => {
    const capabilities: Capability[] = [
      {
        id: 'cap-1',
        name: 'Test Capability',
        currentScore: 0,
        trend: 'stable',
        teamsTargeting: 0,
      },
    ];

    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
      {
        id: 'team-b',
        name: 'Team B',
        targetedCapabilities: [],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 1 },
          { team: 'team-a', date: '28.1.2026', value: 2 }, // Most recent for team-a
          { team: 'team-b', date: '27.1.2026', value: 4 }, // Most recent for team-b (only has one submission)
        ],
      },
    ];

    const enriched = enrichCapabilitiesWithMetrics(capabilities, metrics, teams);

    // Should average team-a's most recent (2) and team-b's most recent (4)
    // Average: (2 + 4) / 2 = 3
    expect(enriched[0].currentScore).toBe(3);
  });

  test('enrichCapabilitiesWithMetrics calculates trend from each team most recent values', () => {
    const capabilities: Capability[] = [
      {
        id: 'cap-1',
        name: 'Test Capability',
        currentScore: 0,
        trend: 'stable',
        teamsTargeting: 0,
      },
    ];

    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
      {
        id: 'team-b',
        name: 'Team B',
        targetedCapabilities: [],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          // team-a: previous=1, current=2 (improved by 1)
          { team: 'team-a', date: '27.1.2026', value: 1 },
          { team: 'team-a', date: '28.1.2026', value: 2 },
          // team-b: previous=2, current=4 (improved by 2)
          { team: 'team-b', date: '27.1.2026', value: 2 },
          { team: 'team-b', date: '28.1.2026', value: 4 },
        ],
      },
    ];

    const enriched = enrichCapabilitiesWithMetrics(capabilities, metrics, teams);

    // Current average: (2 + 4) / 2 = 3
    // Previous average: (1 + 2) / 2 = 1.5
    // Difference: 3 - 1.5 = 1.5 > 0.1, so trend should be 'up'
    expect(enriched[0].currentScore).toBe(3);
    expect(enriched[0].trend).toBe('up');
  });

  test('enrichCapabilitiesWithMetrics calculates trend with 0.1 threshold', () => {
    const capabilities: Capability[] = [
      {
        id: 'cap-1',
        name: 'Test Capability',
        currentScore: 0,
        trend: 'stable',
        teamsTargeting: 0,
      },
    ];

    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '27.1.2026', value: 2.0 },
          { team: 'team-a', date: '28.1.2026', value: 2.2 }, // Increased by 0.2 > 0.1 threshold
        ],
      },
    ];

    const enriched = enrichCapabilitiesWithMetrics(capabilities, metrics, teams);

    // Should show 'up' trend since difference (0.2) exceeds threshold (0.1)
    expect(enriched[0].trend).toBe('up');
  });

  test('enrichTeamsWithMetrics handles dates across different months', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Team A',
        targetedCapabilities: [{ id: 'cap-1', currentScore: null, trend: null }],
        nonTargetedCapabilities: [],
        activeExperiments: [],
      },
    ];

    const metrics: Metric[] = [
      {
        capabilityId: 'cap-1',
        data: [
          { team: 'team-a', date: '31.1.2026', value: 1 }, // January 31
          { team: 'team-a', date: '1.2.2026', value: 2 }, // February 1 - should be most recent
          { team: 'team-a', date: '15.1.2026', value: 0 }, // January 15
        ],
      },
    ];

    const enriched = enrichTeamsWithMetrics(teams, metrics);

    // Should correctly identify 1.2.2026 as most recent (not 31.1.2026)
    expect(enriched[0].targetedCapabilities[0].currentScore).toBe(2);
    expect(enriched[0].targetedCapabilities[0].trend).toBe('up');
  });
});
