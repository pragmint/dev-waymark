import type { Team } from '../../core/data/teamTypes';
import type { Capability } from '../../core/data/capabilityTypes';
import {
  getTopThreeCapabilities,
  groupCapabilitiesByCategory,
} from '../../core/data/capabilityQueries';

export interface OverviewPageData {
  teams: Team[];
  topThree: Capability[];
  capabilitiesByCategory: Record<string, Capability[]>;
}

/**
 * Prepares all data needed for the Overview page
 * Pure, testable function
 */
export function prepareOverviewData(teams: Team[], capabilities: Capability[]): OverviewPageData {
  const topThree = getTopThreeCapabilities(capabilities);
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);

  return {
    teams,
    topThree,
    capabilitiesByCategory,
  };
}
