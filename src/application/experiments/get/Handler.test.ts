import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
import { NotFoundError } from '../../../domain/errors';
import type { Experiment } from '../../../schemas/experimentSchemas';

const experiment: Experiment = {
  id: 'exp-1',
  teamId: 'team-1',
  title: 'Test Experiment',
  context: { problemStatement: 'problem', desiredOutcome: 'outcome' },
  hypothesis: { statement: 'hypothesis' },
  intervention: { practiceUnderTest: 'p-1', description: 'desc' },
  status: 'active',
};

const mockExperimentsRepo = { listAll: async () => [experiment] };
const mockTeamsRepo = {
  listAll: async () => [
    {
      id: 'team-1',
      name: 'Team One',
      targetedCapabilities: [],
      nonTargetedCapabilities: [],
      activeExperiments: [],
    },
  ],
  listIdentities: async () => [],
};
const mockCapabilityMetricsRepo = { listAll: async () => [] };
const mockTeamMetricsRepo = { listAll: async () => [] };
const mockPracticesRepo = {
  listAll: async () => [],
  getById: async (id: string) =>
    id === 'p-1' ? { id: 'p-1', title: 'Practice One', content: '' } : null,
};

describe('experiments/get Handler', () => {
  test('returns experiment detail with practice name', async () => {
    const handle = create(
      mockExperimentsRepo,
      mockTeamsRepo,
      mockCapabilityMetricsRepo,
      mockTeamMetricsRepo,
      mockPracticesRepo
    );
    const result = await handle({ experimentId: 'exp-1' });

    expect(result.experiment.id).toBe('exp-1');
    expect(result.practiceName).toBe('Practice One');
    expect(result.team.id).toBe('team-1');
  });

  test('falls back to practiceUnderTest id when practice is not found', async () => {
    const repoWithNoPractice = { ...mockPracticesRepo, getById: async () => null };
    const handle = create(
      mockExperimentsRepo,
      mockTeamsRepo,
      mockCapabilityMetricsRepo,
      mockTeamMetricsRepo,
      repoWithNoPractice
    );
    const result = await handle({ experimentId: 'exp-1' });

    expect(result.practiceName).toBe('p-1');
  });

  test('throws NotFoundError when experiment does not exist', async () => {
    const handle = create(
      mockExperimentsRepo,
      mockTeamsRepo,
      mockCapabilityMetricsRepo,
      mockTeamMetricsRepo,
      mockPracticesRepo
    );

    expect(handle({ experimentId: 'missing' })).rejects.toBeInstanceOf(NotFoundError);
  });

  test('throws NotFoundError when team for the experiment does not exist', async () => {
    const noTeamRepo = { listAll: async () => [], listIdentities: async () => [] };
    const handle = create(
      mockExperimentsRepo,
      noTeamRepo,
      mockCapabilityMetricsRepo,
      mockTeamMetricsRepo,
      mockPracticesRepo
    );

    expect(handle({ experimentId: 'exp-1' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
