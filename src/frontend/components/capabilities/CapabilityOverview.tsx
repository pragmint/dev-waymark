import { Capability } from '../../../domain/capabilityTypes';

type CapabilityOverviewProps = {
  capability: Capability;
};

export const CapabilityOverview = ({ capability }: CapabilityOverviewProps) => (
  <>
    {capability.description && (
      <section class="capability-section">
        <h2>Overview</h2>
        <p>{capability.description}</p>
      </section>
    )}
  </>
);
