import type { Team } from './teamTypes';
import type { Capability } from './capabilityTypes';
import type { Summary } from './summarySchemas';
import { getTopThreeCapabilities } from './capabilityQueries';
import type { OverviewPageProps } from '../frontend/Pages/OverviewPage';

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
    selectedSummary = summaries.length > 0 ? summaries[0] : null;
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
