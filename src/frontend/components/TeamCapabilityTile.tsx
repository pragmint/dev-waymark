import type { FC } from 'hono/jsx';
import type { TeamCapability } from '../../domain/teamTypes';
import type { Capability } from '../../domain/capabilityTypes';
import { TrendIcon } from './TrendIcon';

interface TeamCapabilityTileProps {
  teamCapability: TeamCapability;
  capability: Capability;
  teamId?: string;
}

export const TeamCapabilityTile: FC<TeamCapabilityTileProps> = ({
  teamCapability,
  capability,
  teamId,
}) => {
  const scoreDisplay = teamCapability.currentScore !== null ? teamCapability.currentScore : '-';

  // Build URL with team query parameter if teamId is provided
  const capabilityUrl = teamId
    ? `/catalog/capability/${capability.id}?team=${teamId}`
    : `/catalog/capability/${capability.id}`;

  return (
    <a href={capabilityUrl} style="text-decoration: none; color: inherit;">
      <div class="capability-tile" data-capability-id={capability.id}>
        <div class="capability-tile-header">
          <h3 class="capability-tile-name">{capability.name}</h3>
          {teamCapability.trend !== null && <TrendIcon trend={teamCapability.trend} />}
        </div>
        <div class="capability-tile-score">
          <span class="capability-tile-score-current">{scoreDisplay}</span>
          <span class="capability-tile-score-max">/ 4</span>
        </div>
      </div>
    </a>
  );
};
