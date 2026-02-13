import type { Team } from '../../../core/data/teamTypes';
import type { Capability } from '../../../core/data/capabilityTypes';
import type { Summary } from '../../../core/data/summaryTypes';
import { getTopThreeCapabilities } from '../../../core/data/capabilityQueries';
import { getMostRecentSummary } from '../../../shell/loaders/summaryLoader';
import type { OverviewPageProps } from '../OverviewPage';

/**
 * Prepares all data needed for the Overview page
 * Pure, testable function
 */
export function prepareOverviewData(
  teams: Team[],
  capabilities: Capability[],
  summaries: Summary[],
  requestedDate?: string
): OverviewPageProps {
  const topThree = getTopThreeCapabilities(capabilities);

  // Get the summary to display
  let selectedSummary: Summary | null;
  if (requestedDate) {
    selectedSummary = summaries.find(s => s.dateString === requestedDate) || null;
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
