import { describe, test, expect } from 'bun:test';
import { create } from './Handler';

const mockCapabilitiesRepo = { listAll: async () => [], getMarkdown: async () => null };
const mockCapabilityMetricsRepo = { listAll: async () => [] };
const mockTeamsRepo = { listAll: async () => [], listIdentities: async () => [] };
const mockTeamMetricsRepo = { listAll: async () => [] };

describe('insights/get Handler', () => {
  test('returns insights page data', async () => {
    const handle = create(
      mockCapabilitiesRepo,
      mockCapabilityMetricsRepo,
      mockTeamsRepo,
      mockTeamMetricsRepo
    );
    const result = await handle({});

    expect(result).toBeDefined();
  });

  test('fetches data from all four repositories', async () => {
    let capabilitiesCalled = false;
    let metricsCalled = false;
    let teamsCalled = false;
    let teamMetricsCalled = false;

    const handle = create(
      {
        ...mockCapabilitiesRepo,
        listAll: async () => {
          capabilitiesCalled = true;
          return [];
        },
      },
      {
        listAll: async () => {
          metricsCalled = true;
          return [];
        },
      },
      {
        listAll: async () => {
          teamsCalled = true;
          return [];
        },
        listIdentities: async () => [],
      },
      {
        listAll: async () => {
          teamMetricsCalled = true;
          return [];
        },
      }
    );
    await handle({});

    expect(capabilitiesCalled).toBe(true);
    expect(metricsCalled).toBe(true);
    expect(teamsCalled).toBe(true);
    expect(teamMetricsCalled).toBe(true);
  });
});
