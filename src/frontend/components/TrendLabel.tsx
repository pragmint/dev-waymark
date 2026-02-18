import { Trend, TrendIcon } from './TrendIcon';

type TrendLabelText = 'Improving' | 'Declining' | 'Stable';

type CapabilityTrendProps = {
  trend: Trend;
};

const trendTextLookup = new Map<Trend, TrendLabelText>([
  ['up', 'Improving'],
  ['down', 'Declining'],
  ['stable', 'Stable'],
]);

export const TrendLabel = ({ trend }: CapabilityTrendProps) => {
  const text = trendTextLookup.get(trend);

  return (
    <div class={`trend-text-label ${trend}`}>
      <TrendIcon trend={trend} />
      <span class="trend-label">{text}</span>
    </div>
  );
};
