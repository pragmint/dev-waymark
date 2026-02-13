import type { FC } from 'hono/jsx';
import type { Capability } from '../../core/data/capabilityTypes';

function getTrendIcon(trend: string): string {
  switch (trend) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
    default:
      return '→';
  }
}

interface CapabilityTileProps {
  capability: Capability;
}

export const CapabilityTile: FC<CapabilityTileProps> = ({ capability }) => {
  const trendIcon = getTrendIcon(capability.trend);

  return (
    <a href={`/catalog/capability/${capability.id}`} style="text-decoration: none; color: inherit;">
      <div class="capability-tile" data-capability-id={capability.id}>
        <div class="capability-tile-header">
          <h3 class="capability-tile-name">{capability.name}</h3>
          <span class={`capability-tile-trend ${capability.trend}`}>{trendIcon}</span>
        </div>
        <div class="capability-tile-score">
          <span class="capability-tile-score-current">{capability.currentScore}</span>
          <span class="capability-tile-score-max">/ 4</span>
        </div>
        <div class="capability-tile-teams">
          <span class="capability-tile-teams-count">{capability.teamsTargeting}</span>
          {' team'}
          {capability.teamsTargeting !== 1 ? 's' : ''}
          {' targeting'}
        </div>
      </div>
    </a>
  );
};
