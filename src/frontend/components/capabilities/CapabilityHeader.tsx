import { Capability } from '../../../domain/capabilityTypes';
import { TrendLabel } from '../TrendLabel';

type CapabilityHeaderProps = {
  capability: Capability;
};

export const CapabilityHeader = ({ capability }: CapabilityHeaderProps) => {
  return (
    <div class="capability-header">
      <div class="capability-header-main">
        <div class="capability-meta">
          <div class="capability-score-large">
            <span class="score-current">{capability.currentScore}</span>
            <span class="score-max">/ 4</span>
          </div>
          <TrendLabel trend={capability.trend} />
        </div>
      </div>
      <div class="capability-teams-info">
        <strong>{capability.teamsTargeting}</strong> team
        {capability.teamsTargeting !== 1 ? 's' : ''} currently targeting this capability
      </div>
    </div>
  );
};
