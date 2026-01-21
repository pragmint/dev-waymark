import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { CapabilityTile } from '../components/CapabilityTile';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import type { Team } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';

interface OverviewPageProps {
  teams: Team[];
  topThree: Capability[];
  capabilitiesByCategory: Record<string, Capability[]>;
}

export const OverviewPage: FC<OverviewPageProps> = ({ teams, topThree, capabilitiesByCategory }) => {
  return (
    <Page title="Overview" heading="Overview" activePage="overview" teams={teams}>
      <div class="capability-tiles-container">
        <div id="top-capabilities" class="capability-tiles-grid">
          {topThree.map(capability => (
            <CapabilityTile capability={capability} />
          ))}
        </div>

        <div id="expanded-capabilities" class="expanded-capabilities">
          {Object.entries(capabilitiesByCategory).map(([category, capabilities]) => (
            <div class="capability-category-section">
              <h3 class="capability-category-title">{category}</h3>
              <div class="capability-tiles-grid">
                {capabilities.map(capability => (
                  <CapabilityTile capability={capability} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <a class="toggle-view-link" id="toggle-view" href="#">
          View All Capabilities
        </a>
      </div>

      <ExecutiveSummary />

      <script src="/resources/public/overview.js"></script>
    </Page>
  );
};
