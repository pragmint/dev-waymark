// Data transformation for chart rendering

import { filterByDateRange, sortByDate, getNumericValue } from './insights-utils';
import { formatDataDateForDisplay } from './insights-date-utils';
import type { ChartData, ChartDataset } from './chart-types';

export interface MetricDataPoint {
  team?: string;
  date: string;
  value: number | string | Record<string, number>;
}

export interface TeamMetricDataPoint {
  date: string;
  value: number | string;
}

export interface CapabilityMetric {
  capabilityId: string;
  data: MetricDataPoint[];
}

export interface TeamMetric {
  teamId: string;
  metricName: string;
  data: TeamMetricDataPoint[];
}

export interface TeamInfo {
  id: string;
  name: string;
}

export type { ChartData, ChartDataset };

/**
 * Convert team ID to display name using team lookup
 */
export function teamIdToName(teamId: string, teams: TeamInfo[]): string {
  const team = teams.find(t => t.id === teamId);
  return team ? team.name : teamId;
}

const CHART_COLORS = [
  { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.2)' },
  { border: 'rgb(255, 99, 132)', bg: 'rgba(255, 99, 132, 0.2)' },
  { border: 'rgb(54, 162, 235)', bg: 'rgba(54, 162, 235, 0.2)' },
  { border: 'rgb(255, 206, 86)', bg: 'rgba(255, 206, 86, 0.2)' },
  { border: 'rgb(153, 102, 255)', bg: 'rgba(153, 102, 255, 0.2)' },
];

/**
 * Transform team-specific metric data into chart format
 */
export function transformTeamMetricData(
  metric: TeamMetric,
  startDate: string,
  endDate: string,
  teams: TeamInfo[]
): ChartData {
  const filteredData = filterByDateRange(metric.data, startDate, endDate);
  const sortedData = sortByDate(filteredData);

  return {
    labels: sortedData.map(d => formatDataDateForDisplay(d.date)),
    datasets: [
      {
        label: `${teamIdToName(metric.teamId, teams)} - ${metric.metricName}`,
        data: sortedData.map(d => getNumericValue(d.value)),
        borderColor: CHART_COLORS[0].border,
        backgroundColor: CHART_COLORS[0].bg,
      },
    ],
  };
}

/**
 * Group capability metric data by team
 */
function groupByTeam(
  data: MetricDataPoint[]
): Map<string, Array<{ date: string; value: number | null }>> {
  const teamDataMap = new Map<string, Array<{ date: string; value: number | null }>>();

  data.forEach(point => {
    const team = point.team || 'unknown';
    if (!teamDataMap.has(team)) {
      teamDataMap.set(team, []);
    }
    teamDataMap.get(team)!.push({
      date: point.date,
      value: getNumericValue(point.value),
    });
  });

  return teamDataMap;
}

/**
 * Create datasets for each team with proper color coding
 */
function createTeamDatasets(
  teamDataMap: Map<string, Array<{ date: string; value: number | null }>>,
  allDates: string[],
  teams: TeamInfo[]
): ChartDataset[] {
  const datasets: ChartDataset[] = [];
  let colorIndex = 0;

  teamDataMap.forEach((teamData, teamId) => {
    const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
    colorIndex++;

    const dataArray = allDates.map(date => {
      const point = teamData.find(d => d.date === date);
      return point ? point.value : null;
    });

    datasets.push({
      label: teamIdToName(teamId, teams),
      data: dataArray,
      borderColor: color.border,
      backgroundColor: color.bg,
    });
  });

  return datasets;
}

/**
 * Transform capability metric data into chart format
 */
export function transformCapabilityMetricData(
  metric: CapabilityMetric,
  startDate: string,
  endDate: string,
  teams: TeamInfo[]
): ChartData | null {
  const filteredData = filterByDateRange(metric.data, startDate, endDate);

  if (filteredData.length === 0) {
    return null;
  }

  const teamDataMap = groupByTeam(filteredData);
  const allDates = Array.from(new Set(filteredData.map(d => d.date)));
  const sortedDates = sortByDate(allDates.map(date => ({ date }))).map(d => d.date);
  const datasets = createTeamDatasets(teamDataMap, sortedDates, teams);

  return {
    labels: sortedDates.map(date => formatDataDateForDisplay(date)),
    datasets,
  };
}
