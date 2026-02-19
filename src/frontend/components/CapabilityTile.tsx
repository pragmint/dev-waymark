import { CapabilityProps } from '../../types/global';
import { TrendIcon } from './TrendIcon';

export const CapabilityTile = ({ capability }: CapabilityProps) => {
  return (
    <a href={`/catalog/capability/${capability.id}`} style="text-decoration: none; color: inherit;">
      <div class="capability-tile" data-capability-id={capability.id}>
        <div class="capability-tile-header">
          <h3 class="capability-tile-name">{capability.name}</h3>
          <TrendIcon trend={capability.trend} />
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
