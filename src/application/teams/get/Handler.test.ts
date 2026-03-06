import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
import type { Team } from '../../../schemas/teamSchemas';

const team: Team = {
  id: 'team-1',
  name: 'Team One',
  targetedCapabilities: [],
  nonTargetedCapabilities: [],
  activeExperiments: [],
};

const mockCapabilitiesRepo = { listAll: async () => [], getMarkdown: async () => null };
const mockCapabilityMetricsRepo = { listAll: async () => [] };
const mockTeamsRepo = { listAll: async () => [team], listIdentities: async () => [] };
const mockTeamMetricsRepo = { listAll: async () => [] };
const mockExperimentsRepo = { listAll: async () => [] };
const mockPracticesRepo = {
  listAll: async () => [],
  getById: async () => null,
};

describe('teams/get Handler', () => {
  test('returns team detail page props for a known team', async () => {
    const handle = create(
      mockCapabilitiesRepo,
      mockCapabilityMetricsRepo,
      mockTeamsRepo,
      mockTeamMetricsRepo,
      mockExperimentsRepo,
      mockPracticesRepo
    );
    const result = await handle({ teamId: 'team-1' });

    expect(result).toBeDefined();
  });

  test('fetches practices for all experiment interventions', async () => {
    let practiceQueried: string | undefined;
    const trackedPracticesRepo = {
      listAll: async () => [],
      getById: async (id: string) => {
        practiceQueried = id;
        return { id, title: 'Practice', content: '' };
      },
    };
    const teamsWithExperiment = {
      listIdentities: async () => [],
      listAll: async () => [
        {
          ...team,
          activeExperiments: [
            {
              id: 'ae-1',
              practiceId: 'p-active',
              startDate: '2026-01-01',
              hypothesis: 'hypothesis',
              status: 'in-progress' as const,
            },
          ],
        },
      ],
    };
    const experimentsWithIntervention = {
      listAll: async () => [
        {
          id: 'exp-1',
          teamId: 'team-1',
          title: 'Exp',
          context: { problemStatement: 'p', desiredOutcome: 'o' },
          hypothesis: { statement: 'h' },
          intervention: { practiceUnderTest: 'p-exp', description: 'd' },
          status: 'active' as const,
        },
      ],
    };

    const handle = create(
      mockCapabilitiesRepo,
      mockCapabilityMetricsRepo,
      teamsWithExperiment,
      mockTeamMetricsRepo,
      experimentsWithIntervention,
      trackedPracticesRepo
    );
    await handle({ teamId: 'team-1' });

    expect(practiceQueried).toBeDefined();
  });
});
