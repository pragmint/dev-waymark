import { TrendDirection } from '../../domain/capabilityTypes';

export type Trend = 'up' | 'down' | 'stable';
export type TrendIconChar = '↑' | '↓' | '→';

type TrendIconProps = {
  trend: TrendDirection;
};

const trendIconLookup = new Map<Trend, TrendIconChar>([
  ['up', '↑'],
  ['down', '↓'],
  ['stable', '→'],
]);

export const TrendIcon = ({ trend }: TrendIconProps) => {
  const icon = trendIconLookup.get(trend);
  if (icon !== undefined) return <span class={`trend-icon ${trend}`}>{icon}</span>;
  else return <span class="trend-icon">?</span>;
};
