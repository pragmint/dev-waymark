import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { CapabilityTile } from '../components/CapabilityTile';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import type { Team } from '../../domain/teamTypes';
import type { Capability } from '../../domain/capabilityTypes';

export interface OverviewPageProps {
  teams: Team[];
  topThree: Capability[];
  allCapabilities: Capability[];
  summaryHtml: string;
  summaryDate: string;
  availableSummaryDates: string[];
}

export const OverviewPage: FC<OverviewPageProps> = ({
  teams,
  topThree,
  allCapabilities,
  summaryHtml,
  summaryDate,
  availableSummaryDates,
}) => {
  return (
    <Page title="Overview" heading="Overview" activePage="overview" teams={teams}>
      <div class="capability-tiles-container">
        <div id="top-capabilities" class="capability-tiles-grid">
          {topThree.map(capability => (
            <CapabilityTile capability={capability} />
          ))}
        </div>

        <div id="expanded-capabilities" class="expanded-capabilities">
          <div class="capability-tiles-grid">
            {allCapabilities.map(capability => (
              <CapabilityTile capability={capability} />
            ))}
          </div>
        </div>

        <a class="toggle-view-link" id="toggle-view" href="#">
          View All Capabilities
        </a>
      </div>

      <ExecutiveSummary
        htmlContent={summaryHtml}
        currentDate={summaryDate}
        availableDates={availableSummaryDates}
      />

      <script src="/public/overview.js"></script>
    </Page>
  );
};
