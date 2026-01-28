import type { Capability, TrendDirection } from './capabilityTypes';
import type { Metric } from '../../shell/loaders/metricLoader';
import { parseDate } from '../utils/dateFormatter';

// Pure query functions - no I/O, no mutation

export function findCapabilityById(capabilities: Capability[], id: string): Capability | undefined {
  return capabilities.find(c => c.id === id);
}

/**
 * Calculate capability score for a specific team or all teams
 * Returns a modified capability with team-specific score and trend
 */
export function getCapabilityScoreForTeam(
  capability: Capability,
  metrics: Metric[],
  teamFilter: string | null
): Capability {
  // If no team filter or "all", return the capability as is (already has aggregated scores)
  if (!teamFilter || teamFilter === 'all') {
    return capability;
  }

  // Find the metric for this capability
  const metric = metrics.find(m => m.capabilityId === capability.id);

  if (!metric || metric.data.length === 0) {
    return {
      ...capability,
      currentScore: 0,
      trend: 'stable' as TrendDirection,
    };
  }

  // Filter data for the specific team
  const teamData = metric.data.filter(d => d.team === teamFilter);

  if (teamData.length === 0) {
    return {
      ...capability,
      currentScore: 0,
      trend: 'stable' as TrendDirection,
    };
  }

  // Sort by date (most recent first)
  const sortedData = teamData.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
  );

  // Get current score
  const currentScore = typeof sortedData[0].value === 'number' ? sortedData[0].value : 0;

  // Calculate trend
  let trend: TrendDirection = 'stable';
  if (sortedData.length >= 2) {
    const currentValue = typeof sortedData[0].value === 'number' ? sortedData[0].value : 0;
    const previousValue = typeof sortedData[1].value === 'number' ? sortedData[1].value : 0;
    const scoreDiff = currentValue - previousValue;

    if (scoreDiff > 0) {
      trend = 'up';
    } else if (scoreDiff < 0) {
      trend = 'down';
    }
  }

  return {
    ...capability,
    currentScore,
    trend,
  };
}

export function getTopThreeCapabilities(capabilities: Capability[]): Capability[] {
  // Return the top 3 capabilities by current score, with ties broken by teams targeting
  return [...capabilities]
    .sort((a, b) => {
      if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
      }
      return b.teamsTargeting - a.teamsTargeting;
    })
    .slice(0, 3);
}

export function getAllCapabilities(capabilities: Capability[]): Capability[] {
  // Return all capabilities sorted alphabetically by name
  return [...capabilities].sort((a, b) => a.name.localeCompare(b.name));
}
