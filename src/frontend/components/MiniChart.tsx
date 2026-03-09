import type { FC } from 'hono/jsx';

export interface MiniChartDataset {
  label: string;
  data: (number | null)[];
  borderColor: string;
  backgroundColor: string;
}

export interface MiniChartData {
  labels: string[];
  datasets: MiniChartDataset[];
}

export const MiniChart: FC<{ chartData: MiniChartData | null; metricId: string }> = ({
  chartData,
  metricId,
}) => {
  if (!chartData) {
    return <p class="mini-chart-no-data">No data available for this metric</p>;
  }
  return (
    <div class="mini-chart-wrapper">
      <canvas
        class="mini-chart-canvas"
        data-chart={JSON.stringify(chartData)}
        aria-label={`Chart for ${metricId}`}
      />
    </div>
  );
};
