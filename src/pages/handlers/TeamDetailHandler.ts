import type { Team } from '../../core/data/teamTypes';
import type { Capability } from '../../core/data/capabilityTypes';
import type { Practice } from '../../shell/loaders/practiceLoader';
import { findTeamById } from '../../core/data/teamQueries';
import { groupCapabilitiesByCategory } from '../../core/data/capabilityQueries';
import { loadPracticeFromFilesystem } from '../../shell/loaders/practiceLoader';
import { NotFoundError } from '../../core/errors';

export interface TeamDetailPageData {
  teams: Team[];
  team: Team;
  capabilitiesByCategory: Record<string, Capability[]>;
  capabilityMap: Map<string, Capability>;
  practiceMap: Map<string, Practice>;
}

/**
 * Prepares all data needed for the Team Detail page
 * Pure, testable function that orchestrates data loading and transformation
 * @throws {NotFoundError} if team is not found
 */
export async function prepareTeamDetailData(
  teamId: string,
  teams: Team[],
  capabilities: Capability[]
): Promise<TeamDetailPageData> {
  // Find the requested team
  const team = findTeamById(teams, teamId);
  if (!team) {
    throw new NotFoundError('Team', teamId);
  }

  // Prepare capability data for rendering
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);
  const capabilityMap = new Map(capabilities.map(cap => [cap.id, cap]));

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
    capabilitiesByCategory,
    capabilityMap,
    practiceMap,
  };
}
