import { describe, test, expect } from 'bun:test';
import { findExperimentById } from './teamQueries';
import type { Team } from './teamTypes';

describe('Team Queries', () => {
  const teams: Team[] = [
    {
      id: 'team-a',
      name: 'Team Alpha',
      targetedCapabilities: [],
      nonTargetedCapabilities: [],
      activeExperiments: [
        {
          id: 'exp-1',
          practiceId: 'tdd',
          startDate: '2024-01-01',
          hypothesis: 'TDD will improve code quality',
          status: 'in-progress',
        },
      ],
    },
    {
      id: 'team-b',
      name: 'Team Beta',
      targetedCapabilities: [],
      nonTargetedCapabilities: [],
      activeExperiments: [
        {
          id: 'exp-2',
          practiceId: 'pair-programming',
          startDate: '2024-02-01',
          hypothesis: 'Pair programming will reduce bugs',
          status: 'in-progress',
        },
      ],
    },
  ];

  test('findExperimentById finds experiment across teams', () => {
    const result = findExperimentById(teams, 'exp-2');

    expect(result).toBeDefined();
    expect(result?.team.id).toBe('team-b');
    expect(result?.experiment.practiceId).toBe('pair-programming');
  });

  test('findExperimentById returns undefined for non-existent experiment', () => {
    const result = findExperimentById(teams, 'exp-999');

    expect(result).toBeUndefined();
  });
});
