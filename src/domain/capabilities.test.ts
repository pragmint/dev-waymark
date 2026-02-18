import { describe, test, expect } from 'bun:test';
import { getTopThreeCapabilities } from './capabilityQueries';
import type { Capability } from './capabilityTypes';

describe('Capability Data Transformations', () => {
  test('getTopThreeCapabilities returns top 3 by score', () => {
    const capabilities: Capability[] = [
      {
        id: 'cap-1',
        name: 'Continuous Integration',
        currentScore: 3.5,
        trend: 'up',
        teamsTargeting: 2,
      },
      { id: 'cap-2', name: 'Automated Testing', currentScore: 2.5, trend: 'up', teamsTargeting: 1 },
      {
        id: 'cap-3',
        name: 'Learning Culture',
        currentScore: 1.5,
        trend: 'stable',
        teamsTargeting: 0,
      },
    ];
    const topThree = getTopThreeCapabilities(capabilities);

    expect(topThree).toHaveLength(3);
    expect(topThree[0].currentScore).toBe(3.5);
    expect(topThree[1].currentScore).toBe(2.5);
    expect(topThree[2].currentScore).toBe(1.5);
  });
});
