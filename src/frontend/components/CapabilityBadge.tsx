import type { FC } from 'hono/jsx';

type CapabilityBadgeProps = {
  capabilityName: string;
};

export const CapabilityBadge: FC<CapabilityBadgeProps> = ({ capabilityName }) => {
  return <span class="capability-badge">{capabilityName}</span>;
};
