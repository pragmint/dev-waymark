import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { CapabilityTile } from '../components/CapabilityTile';
import type { Team } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';

interface CapabilityCatalogPageProps {
  teams: Team[];
  allCapabilities: Capability[];
}

export const CapabilityCatalogPage: FC<CapabilityCatalogPageProps> = ({
  teams,
  allCapabilities,
}) => {
  return (
    <Page title="Capabilities" heading="Capabilities" activePage="capabilities" teams={teams}>
      <div class="capability-tiles-container">
        <div class="capability-tiles-grid">
          {allCapabilities.map(capability => (
            <CapabilityTile capability={capability} />
          ))}
        </div>
      </div>

      <script src="/resources/public/overview.js"></script>
    </Page>
  );
};
