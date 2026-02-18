import { CapabilityProps } from '../../../types/global';

export const CapabilityOverview = ({ capability }: CapabilityProps) => (
  <>
    {capability.description && (
      <section class="capability-section">
        <h2>Overview</h2>
        <p>{capability.description}</p>
      </section>
    )}
  </>
);
