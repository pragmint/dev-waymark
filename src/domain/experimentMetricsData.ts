import { getNumericValue } from './metricHelpers';
import { parseDate } from './parseDate';
import type { CapabilityMetric } from '../schemas/metricSchemas';
import type { TeamMetric } from '../schemas/metricSchemas';
import type { MiniChartData } from '../frontend/components/MiniChart';

const CHART_COLOR = { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.2)' };

export function formatMetricDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('en-US', {
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
    (a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime()
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
    (a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime()
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
