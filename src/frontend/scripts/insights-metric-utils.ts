// Pure utility functions for metric lookups
// Separated from insights.ts to allow testing without ES module exports

import type { CapabilityMetric, TeamMetric } from './insights-data';
import type { MetricOption } from '../../domain/prepareInsightsData';

export interface MetricsData {
  availableDates: string[];
  teams: { id: string; name: string }[];
  metricOptions: MetricOption[];
  capabilityMetrics: CapabilityMetric[];
  teamMetrics: TeamMetric[];
}

/**
 * Find a metric by ID in the loaded data
 */
export function findMetric(
  metricId: string,
  data: MetricsData
): { type: 'capability'; metric: CapabilityMetric } | { type: 'team'; metric: TeamMetric } | null {
  // Check if it's a team-specific metric (format: teamId:metricName)
  if (metricId.includes(':')) {
    const [teamId, metricName] = metricId.split(':');
    const teamMetric = data.teamMetrics.find(
      m => m.teamId === teamId && m.metricName === metricName
    );
    if (teamMetric) {
      return { type: 'team', metric: teamMetric };
    }
  }

  // Otherwise, it's a capability metric
  const capabilityMetric = data.capabilityMetrics.find(m => m.capabilityId === metricId);
  if (capabilityMetric) {
    return { type: 'capability', metric: capabilityMetric };
  }

  return null;
}

/**
 * Get metric label from metric options
 */
export function getMetricLabel(metricId: string, metricOptions: MetricOption[]): string {
  const option = metricOptions.find(opt => opt.id === metricId);
  return option?.label || metricId;
}

/**
 * Check if a metric is a capability metric (score 0-4)
 */
export function isCapabilityMetric(metricId: string): boolean {
  return !metricId.includes(':');
}
