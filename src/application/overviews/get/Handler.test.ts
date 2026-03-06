import { describe, test, expect } from 'bun:test';
import { create } from './Handler';

const mockCapabilitiesRepo = { listAll: async () => [], getMarkdown: async () => null };
const mockCapabilityMetricsRepo = { listAll: async () => [] };
const mockTeamsRepo = { listAll: async () => [], listIdentities: async () => [] };
const mockSummariesRepo = { listAll: async () => [] };

describe('overviews/get Handler', () => {
  test('returns overview page props', async () => {
    const handle = create(
      mockCapabilitiesRepo,
      mockCapabilityMetricsRepo,
      mockTeamsRepo,
      mockSummariesRepo
    );
    const result = await handle({});

    expect(result).toBeDefined();
  });

  test('passes date to prepareOverviewData when provided', async () => {
    const handle = create(
      mockCapabilitiesRepo,
      mockCapabilityMetricsRepo,
      mockTeamsRepo,
      mockSummariesRepo
    );
    const result = await handle({ date: '2026-01-01' });

    expect(result).toBeDefined();
  });
});
