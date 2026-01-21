import type { FC } from 'hono/jsx';
import type { TeamCapability } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';
import { getTrendIcon } from '../core/rendering/htmlHelpers';

interface TeamCapabilityTileProps {
  teamCapability: TeamCapability;
  capability: Capability;
}

export const TeamCapabilityTile: FC<TeamCapabilityTileProps> = ({ teamCapability, capability }) => {
  const trendIcon = getTrendIcon(teamCapability.trend);

  return (
    <a href={`/catalog/capability/${capability.id}`} style="text-decoration: none; color: inherit;">
      <div class="capability-tile" data-capability-id={capability.id}>
        <div class="capability-tile-header">
          <h3 class="capability-tile-name">{capability.name}</h3>
          <span class={`capability-tile-trend ${teamCapability.trend}`}>{trendIcon}</span>
        </div>
        <div class="capability-tile-score">
          <span class="capability-tile-score-current">{teamCapability.currentScore}</span>
          <span class="capability-tile-score-max">/ 4</span>
        </div>
        <div class="capability-tile-category">
          {capability.category}
        </div>
      </div>
    </a>
  );
};
