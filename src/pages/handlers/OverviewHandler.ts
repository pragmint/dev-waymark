import type { Team } from '../../core/data/teamTypes';
import type { Capability } from '../../core/data/capabilityTypes';
import type { Summary } from '../../core/data/summaryTypes';
import { getTopThreeCapabilities } from '../../core/data/capabilityQueries';
import { getMostRecentSummary, getSummaryByDate } from '../../shell/loaders/summaryLoader';

export interface OverviewPageData {
  teams: Team[];
  topThree: Capability[];
  allCapabilities: Capability[];
  summaryHtml: string;
  summaryDate: string;
  availableSummaryDates: string[];
}

/**
 * Prepares all data needed for the Overview page
 * Pure, testable function
 */
export function prepareOverviewData(
  teams: Team[],
  capabilities: Capability[],
  summaries: Summary[],
  requestedDate?: string
): OverviewPageData {
  const topThree = getTopThreeCapabilities(capabilities);

  // Get the summary to display
  let selectedSummary: Summary | null;
  if (requestedDate) {
    selectedSummary = getSummaryByDate(summaries, requestedDate);
  } else {
    selectedSummary = getMostRecentSummary(summaries);
  }

  // Fallback if no summary found
  const summaryHtml = selectedSummary?.htmlContent || '<p>No summary available.</p>';
  const summaryDate = selectedSummary?.dateString || '';
  const availableSummaryDates = summaries.map(s => s.dateString);

  return {
    teams,
    topThree,
    allCapabilities: capabilities,
    summaryHtml,
    summaryDate,
    availableSummaryDates,
  };
}
