import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { CapabilityTile } from '../components/CapabilityTile';
import type { Capability } from '../../schemas/capabilitySchemas';

export interface CapabilityCatalogPageProps {
  allCapabilities: Capability[];
}

export const CapabilityCatalogPage: FC<CapabilityCatalogPageProps> = ({
  allCapabilities,
}) => {
  return (
    <Page title="Capabilities" heading="Capabilities" activePage="capabilities">
      <div class="capability-tiles-container">
        <div class="capability-tiles-grid">
          {allCapabilities.map(capability => (
            <CapabilityTile capability={capability} />
          ))}
        </div>
      </div>

      <script src="/public/overview.js"></script>
    </Page>
  );
};
