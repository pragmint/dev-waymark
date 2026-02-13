import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityMetric } from '../../frontend/scripts/insights-data';
import type { TeamMetric } from '../../parsers/yaml/metricParser';
import { parseCapabilityMetricYaml, parseTeamMetricYaml } from '../../parsers/yaml/metricParser';

// Re-export types from metricParser for downstream consumers
export type {
  MetricDataPoint,
  MetricValue,
  MetricFile,
  Metric,
  TeamMetricDataPoint,
  TeamMetricFile,
  TeamMetric,
} from '../../parsers/yaml/metricParser';

// Re-export schemas for downstream consumers
export {
  MetricDataPointSchema,
  MetricFileSchema,
  TeamMetricDataPointSchema,
  TeamMetricFileSchema,
} from '../../parsers/yaml/metricParser';

/**
 * Pure I/O function - loads capability metrics from filesystem with validation
 * Each file corresponds to a capability and contains team scores over time
 */
export async function loadCapabilityMetricsFromFilesystem(): Promise<CapabilityMetric[]> {
  const dir = 'examples/metrics/capability_scores';

  try {
    const files = await readdir(dir);

    const metrics = await Promise.all(
      files
        .filter(file => file.endsWith('.yaml'))
        .map(async file => {
          const filePath = join(dir, file);
          const content = await Bun.file(filePath).text();
          const metricFile = parseCapabilityMetricYaml(content, file);

          // Extract capability ID from filename (remove .yaml extension)
          const capabilityId = file.replace('.yaml', '');

          return {
            capabilityId,
            data: metricFile.data,
          } as CapabilityMetric;
        })
    );

    console.log(`Loaded ${metrics.length} capability metrics`);

    return metrics;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Capability metrics directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}

/**
 * Pure I/O function - loads team-specific metrics from filesystem with validation
 * Directory structure: metrics/team_specific/{team_id}/{metric-name}.yaml
 */
export async function loadTeamMetricsFromFilesystem(): Promise<TeamMetric[]> {
  const baseDir = 'examples/metrics/team_specific';

  try {
    const teamDirs = await readdir(baseDir);
    const teamMetrics: TeamMetric[] = [];

    // Process each team directory
    for (const teamDir of teamDirs) {
      const teamDirPath = join(baseDir, teamDir);

      // Skip non-directories
      try {
        const files = await readdir(teamDirPath);

        // Convert team_a -> team-a
        const teamId = teamDir.replace(/_/g, '-');

        // Load each metric file
        for (const file of files) {
          if (!file.endsWith('.yaml')) continue;

          const filePath = join(teamDirPath, file);
          const metricName = file.replace('.yaml', '');

          const content = await Bun.file(filePath).text();
          const metricFile = parseTeamMetricYaml(content, file);

          teamMetrics.push({
            teamId,
            metricName,
            data: metricFile.data,
          });
        }
      } catch {
        // Skip if not a directory or can't read
        continue;
      }
    }

    console.log(`Loaded ${teamMetrics.length} team metrics`);
    return teamMetrics;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Team metrics directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
