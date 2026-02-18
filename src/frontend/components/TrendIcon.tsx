export type Trend = 'up' | 'down' | 'stable';
export type TrendIcon = '↑' | '↓' | '→';

type TrendIconProps = {
  trend: Trend;
};

const trendIconLookup = new Map<Trend, TrendIcon>([
  ['up', '↑'],
  ['down', '↓'],
  ['stable', '→'],
]);

export const TrendIcon = ({ trend }: TrendIconProps) => {
  const icon = trendIconLookup.get(trend);
  if (icon !== undefined) return <span class={`trend-icon ${trend}`}>{icon}</span>;
  else return <span class="trend-icon">?</span>;
};
