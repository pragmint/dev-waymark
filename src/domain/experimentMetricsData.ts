import { getNumericValue } from '../frontend/scripts/insights-utils';
import { parseDataDate } from '../frontend/scripts/insights-date-utils';
import type { CapabilityMetric } from '../frontend/scripts/insights-data';
import type { TeamMetric } from '../schemas/metricSchemas';
import type { MiniChartData } from '../frontend/components/MiniChart';

const CHART_COLOR = { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.2)' };

export function formatMetricDate(dateStr: string): string {
  return parseDataDate(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function buildCapabilityChartData(
  metric: CapabilityMetric,
  teamId: string,
  teamName: string
): MiniChartData | null {
  const teamData = metric.data.filter(d => d.team === teamId);
  if (teamData.length === 0) return null;

  const sorted = [...teamData].sort(
    (a, b) => parseDataDate(a.date).getTime() - parseDataDate(b.date).getTime()
  );

  return {
    labels: sorted.map(d => formatMetricDate(d.date)),
    datasets: [
      {
        label: teamName,
        data: sorted.map(d => getNumericValue(d.value)),
        borderColor: CHART_COLOR.border,
        backgroundColor: CHART_COLOR.bg,
      },
    ],
  };
}

export function buildTeamMetricChartData(
  metric: TeamMetric,
  teamName: string
): MiniChartData | null {
  if (metric.data.length === 0) return null;

  const sorted = [...metric.data].sort(
    (a, b) => parseDataDate(a.date).getTime() - parseDataDate(b.date).getTime()
  );

  return {
    labels: sorted.map(d => formatMetricDate(d.date)),
    datasets: [
      {
        label: teamName,
        data: sorted.map(d => getNumericValue(d.value)),
        borderColor: CHART_COLOR.border,
        backgroundColor: CHART_COLOR.bg,
      },
    ],
  };
}

export function resolveMetricChartData(
  metricId: string,
  teamId: string,
  teamName: string,
  capMetrics: CapabilityMetric[],
  tmMetrics: TeamMetric[]
): MiniChartData | null {
  const capMetric = capMetrics.find(m => m.capabilityId === metricId);
  if (capMetric) {
    const data = buildCapabilityChartData(capMetric, teamId, teamName);
    if (data) return data;
  }

  const teamMetric = tmMetrics.find(m => m.teamId === teamId && m.metricName === metricId);
  if (teamMetric) {
    return buildTeamMetricChartData(teamMetric, teamName);
  }

  return null;
}
