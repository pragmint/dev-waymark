import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { CapabilityTile } from '../components/CapabilityTile';
import type { Team } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';

interface CapabilityCatalogPageProps {
  teams: Team[];
  capabilitiesByCategory: Record<string, Capability[]>;
}

export const CapabilityCatalogPage: FC<CapabilityCatalogPageProps> = ({ teams, capabilitiesByCategory }) => {
  return (
    <Page title="Capabilities" heading="Capabilities" activePage="capabilities" teams={teams}>
      <div class="capability-tiles-container">
        {Object.entries(capabilitiesByCategory).map(([category, capabilities]) => (
          <div class="capability-category-section">
            <h2 class="capability-category-title">{category}</h2>
            <div class="capability-tiles-grid">
              {capabilities.map(capability => (
                <CapabilityTile capability={capability} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <script src="/resources/public/overview.js"></script>
    </Page>
  );
};
