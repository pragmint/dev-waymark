import type { Team, TeamCapability } from '../../core/data/teamTypes';
import type { Capability, TrendDirection } from '../../core/data/capabilityTypes';
import type { Practice } from '../../shell/loaders/practiceLoader';
import type { Metric } from '../../shell/loaders/metricLoader';
import { findTeamById } from '../../core/data/teamQueries';
import { getAllCapabilities } from '../../core/data/capabilityQueries';
import { loadPracticeFromFilesystem } from '../../shell/loaders/practiceLoader';
import { NotFoundError } from '../../core/errors';
import { parseDate } from '../../core/utils/dateFormatter';

export interface TeamDetailPageData {
  teams: Team[];
  team: Team;
  allCapabilities: Capability[];
  capabilityMap: Map<string, Capability>;
  teamCapabilityMap: Map<string, TeamCapability>;
  practiceMap: Map<string, Practice>;
}

/**
 * Helper function to enrich a capability with team's metric data
 */
function enrichCapabilityWithTeamMetrics(
  capabilityId: string,
  teamId: string,
  metrics: Metric[]
): TeamCapability {
  // Find the metric for this capability
  const metric = metrics.find(m => m.capabilityId === capabilityId);

  if (!metric) {
    // No metrics for this capability
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  // Find the most recent data point for this team
  const teamData = metric.data.filter(d => d.team === teamId);

  if (teamData.length === 0) {
    // No data for this team
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  // Get most recent score
  const sortedData = teamData.sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime());
  const currentScore = sortedData[0].value;

  // Calculate trend
  let trend: TrendDirection | null = 'stable';
  if (sortedData.length >= 2) {
    const scoreDiff = sortedData[0].value - sortedData[1].value;
    if (scoreDiff > 0) {
      trend = 'up';
    } else if (scoreDiff < 0) {
      trend = 'down';
    }
  } else {
    // Only one data point, no trend
    trend = null;
  }

  return {
    id: capabilityId,
    currentScore,
    trend,
  };
}

/**
 * Prepares all data needed for the Team Detail page
 * Pure, testable function that orchestrates data loading and transformation
 * @throws {NotFoundError} if team is not found
 */
export async function prepareTeamDetailData(
  teamId: string,
  teams: Team[],
  capabilities: Capability[],
  metrics: Metric[]
): Promise<TeamDetailPageData> {
  // Find the requested team
  const team = findTeamById(teams, teamId);
  if (!team) {
    throw new NotFoundError('Team', teamId);
  }

  // Prepare capability data for rendering
  const allCapabilities = getAllCapabilities(capabilities);
  const capabilityMap = new Map(capabilities.map(cap => [cap.id, cap]));

  // Enrich all capabilities with team's metric data
  const teamCapabilityMap = new Map<string, TeamCapability>();
  for (const capability of allCapabilities) {
    const enrichedCapability = enrichCapabilityWithTeamMetrics(capability.id, teamId, metrics);
    teamCapabilityMap.set(capability.id, enrichedCapability);
  }

  // Load practices for all active experiments
  const practiceMap = new Map<string, Practice>();
  for (const experiment of team.activeExperiments) {
    const practice = await loadPracticeFromFilesystem(experiment.practiceId);
    if (practice) {
      practiceMap.set(experiment.practiceId, practice);
    }
  }

  return {
    teams,
    team,
    allCapabilities,
    capabilityMap,
    teamCapabilityMap,
    practiceMap,
  };
}
