import { CapabilityProps } from '../../../types/global';
import { CapabilityJustification } from './CapabilityJustification';
import { CapabilityMaturityLevels } from './CapabilityMaturityLevels';

const MATURITY_LABELS: Record<number, string> = {
  0: 'Not Started',
  1: 'Initial',
  2: 'Developing',
  3: 'Defined',
  4: 'Optimizing',
};

export const CapabilitySection = ({ capability }: CapabilityProps) => {
  const label = MATURITY_LABELS[capability.currentScore] ?? 'Unknown';

  return (
    <section class="capability-section">
      <h2>Current State</h2>
      {capability.maturityLevels?.length ? (
        <CapabilityMaturityLevels capability={capability} />
      ) : (
        <div>
          <div class="maturity-level">
            <div class="maturity-level-header">
              <h3>Maturity Level: {capability.currentScore}</h3>
              <span class="maturity-level-label">{label}</span>
            </div>
            <div class="maturity-progress">
              <div class="maturity-progress-bar">
                <div
                  class="maturity-progress-fill"
                  style={`width: ${(capability.currentScore / 4) * 100}%`}
                ></div>
              </div>
              <div class="maturity-levels">
                {[1, 2, 3, 4].map((n) => (
                  <span class={`level ${capability.currentScore >= n ? 'achieved' : ''}`}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p>
            The organization is currently at level {capability.currentScore}, demonstrating{' '}
            {label.toLowerCase()} implementation of this capability.
          </p>
          <CapabilityJustification text={capability.justification} />
        </div>
      )}
    </section>
  );
};
