import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
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
  getMarkdown: async () => null,
};
const mockMetricsRepo = { listAll: async () => [] };
const mockTeamsRepo = { listAll: async () => [], listIdentities: async () => [] };

describe('capabilities/list Handler', () => {
  test('returns enriched capabilities', async () => {
    const handle = create(mockCapabilitiesRepo, mockMetricsRepo, mockTeamsRepo);
    const result = await handle({});

    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].id).toBe('cap-1');
  });

  test('returns empty list when no capabilities exist', async () => {
    const emptyRepo = { ...mockCapabilitiesRepo, listAll: async () => [] };
    const handle = create(emptyRepo, mockMetricsRepo, mockTeamsRepo);
    const result = await handle({});

    expect(result.capabilities).toHaveLength(0);
  });
});
