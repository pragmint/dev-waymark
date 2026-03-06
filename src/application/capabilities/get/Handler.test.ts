import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
import { NotFoundError } from '../../../domain/errors';
import type { Capability } from '../../../schemas/capabilitySchemas';

const capability: Capability = {
  id: 'cap-1',
  name: 'CI',
  currentScore: 2,
  trend: 'up',
  teamsTargeting: 1,
};

const mockCapabilitiesRepo = {
  listAll: async () => [capability],
  getMarkdown: async (_id: string) => '# CI',
};
const mockMetricsRepo = { listAll: async () => [] };
const mockTeamsRepo = { listAll: async () => [], listIdentities: async () => [] };

describe('capabilities/get Handler', () => {
  test('returns the capability with markdown when found', async () => {
    const handle = create(mockCapabilitiesRepo, mockMetricsRepo, mockTeamsRepo);
    const result = await handle({ capabilityId: 'cap-1', teamFilter: 'all' });

    expect(result.capability.id).toBe('cap-1');
    expect(result.markdownContent).toBe('# CI');
    expect(result.selectedTeam).toBe('all');
  });

  test('throws NotFoundError when capability does not exist', async () => {
    const handle = create(mockCapabilitiesRepo, mockMetricsRepo, mockTeamsRepo);

    expect(handle({ capabilityId: 'missing', teamFilter: 'all' })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
