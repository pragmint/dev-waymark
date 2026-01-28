import { describe, test, expect } from 'bun:test';
import { enrichCapabilitiesWithTeamData } from '../src/core/data/capabilityAggregations';
import {
  getTopThreeCapabilities,
  getAllCapabilities,
  findCapabilityById,
} from '../src/core/data/capabilityQueries';
import type { Capability } from '../src/core/data/capabilityTypes';
import type { Team } from '../src/core/data/teamTypes';

describe('Capability Data Transformations', () => {
  const baseCapabilities: Capability[] = [
    {
      id: 'cap-1',
      name: 'Continuous Integration',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    },
    {
      id: 'cap-2',
      name: 'Automated Testing',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    },
    {
      id: 'cap-3',
      name: 'Learning Culture',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    },
  ];

  const teams: Team[] = [
    {
      id: 'team-a',
      name: 'Team A',
      targetedCapabilities: [
        { id: 'cap-1', currentScore: 3, trend: 'up' },
        { id: 'cap-2', currentScore: 2, trend: 'stable' },
      ],
      nonTargetedCapabilities: [{ id: 'cap-3', currentScore: 1, trend: 'down' }],
      activeExperiments: [],
    },
    {
      id: 'team-b',
      name: 'Team B',
      targetedCapabilities: [{ id: 'cap-1', currentScore: 4, trend: 'up' }],
      nonTargetedCapabilities: [
        { id: 'cap-2', currentScore: 3, trend: 'up' },
        { id: 'cap-3', currentScore: 2, trend: 'stable' },
      ],
      activeExperiments: [],
    },
  ];

  test('enrichCapabilitiesWithTeamData calculates average scores', () => {
    const enriched = enrichCapabilitiesWithTeamData(baseCapabilities, teams);

    // cap-1: (3 + 4) / 2 = 3.5
    expect(enriched[0].currentScore).toBe(3.5);
    // cap-2: (2 + 3) / 2 = 2.5
    expect(enriched[1].currentScore).toBe(2.5);
    // cap-3: (1 + 2) / 2 = 1.5
    expect(enriched[2].currentScore).toBe(1.5);
  });

  test('enrichCapabilitiesWithTeamData counts teams targeting capabilities', () => {
    const enriched = enrichCapabilitiesWithTeamData(baseCapabilities, teams);

    expect(enriched[0].teamsTargeting).toBe(2); // cap-1 targeted by both teams
    expect(enriched[1].teamsTargeting).toBe(1); // cap-2 targeted by team-a only
    expect(enriched[2].teamsTargeting).toBe(0); // cap-3 not targeted by any team
  });

  test('enrichCapabilitiesWithTeamData determines overall trend', () => {
    const enriched = enrichCapabilitiesWithTeamData(baseCapabilities, teams);

    expect(enriched[0].trend).toBe('up'); // both teams: up
    expect(enriched[1].trend).toBe('up'); // stable and up -> up wins
    expect(enriched[2].trend).toBe('stable'); // down and stable -> stable wins
  });

  test('enrichCapabilitiesWithTeamData does not mutate input', () => {
    const originalScore = baseCapabilities[0].currentScore;
    enrichCapabilitiesWithTeamData(baseCapabilities, teams);

    expect(baseCapabilities[0].currentScore).toBe(originalScore);
  });

  test('getTopThreeCapabilities returns top 3 by score', () => {
    const enriched = enrichCapabilitiesWithTeamData(baseCapabilities, teams);
    const topThree = getTopThreeCapabilities(enriched);

    expect(topThree).toHaveLength(3);
    expect(topThree[0].currentScore).toBe(3.5);
    expect(topThree[1].currentScore).toBe(2.5);
    expect(topThree[2].currentScore).toBe(1.5);
  });

  test('getAllCapabilities returns capabilities sorted alphabetically', () => {
    const enriched = enrichCapabilitiesWithTeamData(baseCapabilities, teams);
    const sorted = getAllCapabilities(enriched);

    expect(sorted).toHaveLength(3);
    expect(sorted[0].name).toBe('Automated Testing');
    expect(sorted[1].name).toBe('Continuous Integration');
    expect(sorted[2].name).toBe('Learning Culture');
  });

  test('findCapabilityById returns correct capability', () => {
    const capability = findCapabilityById(baseCapabilities, 'cap-2');

    expect(capability?.name).toBe('Automated Testing');
  });
});
