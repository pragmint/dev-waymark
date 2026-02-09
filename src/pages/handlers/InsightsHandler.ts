import type { Team } from '../../core/data/teamTypes';
import type { Capability } from '../../core/data/capabilityTypes';
import type { TeamMetric } from '../../shell/loaders/metricLoader';
import { CapabilityMetric } from '../../scripts/insights-data';

export interface MetricOption {
  id: string;
  label: string;
  type: 'capability' | 'team-specific';
  teamId?: string;
}

export interface InsightsPageData {
  teams: Team[];
  metricOptions: MetricOption[];
  capabilityMetrics: CapabilityMetric[];
  teamMetrics: TeamMetric[];
  availableDates: string[];
}

/**
 * Prepares all data needed for the Insights page
 * Pure, testable function
 */
export function prepareInsightsData(
  teams: Team[],
  capabilities: Capability[],
  capabilityMetrics: CapabilityMetric[],
  teamMetrics: TeamMetric[]
): InsightsPageData {
  // Build metric options from capabilities
  const capabilityOptions: MetricOption[] = capabilities
    .map(cap => ({
      id: cap.id,
      label: cap.name,
      type: 'capability' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Build metric options from team-specific metrics
  const teamMetricOptions: MetricOption[] = teamMetrics
    .map(metric => ({
      id: `${metric.teamId}:${metric.metricName}`,
      label: `${metric.teamId} - ${metric.metricName}`,
      type: 'team-specific' as const,
      teamId: metric.teamId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Combine all metric options
  const metricOptions = [...capabilityOptions, ...teamMetricOptions];

  // Extract all unique dates from all metrics
  const dateSet = new Set<string>();

  capabilityMetrics.forEach(metric => {
    metric.data.forEach((point: { date: string }) => {
      dateSet.add(point.date);
    });
  });

  teamMetrics.forEach(metric => {
    metric.data.forEach((point: { date: string }) => {
      dateSet.add(point.date);
    });
  });

  const availableDates = Array.from(dateSet).sort((a, b) => {
    // Parse dates in format dd.m.yyyy
    const parseDate = (dateStr: string) => {
      const [day, month, year] = dateStr.split('.');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    };
    return parseDate(a).getTime() - parseDate(b).getTime();
  });

  return {
    teams,
    metricOptions,
    capabilityMetrics,
    teamMetrics,
    availableDates,
  };
}
