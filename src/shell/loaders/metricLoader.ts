import { parse } from 'yaml';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ValidationError } from '../../core/errors';
import { consoleLogger } from '../../core/logger';

// Zod schemas for capability metric data validation
export const MetricDataPointSchema = z.object({
  team: z.string().optional(),
  date: z.string(), // Format: yy.m.dd or similar
  value: z.union([z.number(), z.string()]), // Can be number (capability scores) or string (anecdotes, etc)
});

export const MetricFileSchema = z.object({
  data: z.array(MetricDataPointSchema),
});

export type MetricDataPoint = z.infer<typeof MetricDataPointSchema>;
export type MetricFile = z.infer<typeof MetricFileSchema>;

export interface Metric {
  capabilityId: string;
  data: MetricDataPoint[];
}

// Zod schemas for team metric data validation
export const TeamMetricDataPointSchema = z.object({
  date: z.string(),
  value: z.union([z.number(), z.string()]),
  // No team field - team is derived from filename
});

export const TeamMetricFileSchema = z.object({
  data: z.array(TeamMetricDataPointSchema),
});

export type TeamMetricDataPoint = z.infer<typeof TeamMetricDataPointSchema>;
export type TeamMetricFile = z.infer<typeof TeamMetricFileSchema>;

export interface TeamMetric {
  teamId: string;
  metricName: string;
  data: TeamMetricDataPoint[];
}

/**
 * Pure I/O function - loads capability metrics from filesystem with validation
 * Each file corresponds to a capability and contains team scores over time
 */
export async function loadCapabilityMetricsFromFilesystem(): Promise<Metric[]> {
  const dir = 'resources/private/yaml/metrics/capability_scores';

  try {
    const files = await readdir(dir);

    const metrics = await Promise.all(
      files
        .filter(file => file.endsWith('.yaml'))
        .map(async file => {
          const filePath = join(dir, file);
          const content = await Bun.file(filePath).text();
          const raw = parse(content);

          try {
            // Parse with runtime validation
            const metricFile = MetricFileSchema.parse(raw);

            // Extract capability ID from filename (remove .yaml extension)
            const capabilityId = file.replace('.yaml', '');

            return {
              capabilityId,
              data: metricFile.data,
            };
          } catch (error) {
            if (error instanceof z.ZodError && error.errors) {
              const details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
              consoleLogger.error(`Validation error in ${file}`, { errors: error.errors });
              throw new ValidationError('Metric', file, details);
            }
            throw error;
          }
        })
    );

    consoleLogger.info(`Loaded ${metrics.length} capability metrics`);

    return metrics;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      consoleLogger.warn('Capability metrics directory not found, returning empty array');
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
  const baseDir = 'resources/private/yaml/metrics/team_specific';

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
          const raw = parse(content);

          try {
            // Parse with runtime validation
            const metricFile = TeamMetricFileSchema.parse(raw);

            teamMetrics.push({
              teamId,
              metricName,
              data: metricFile.data,
            });
          } catch (error) {
            if (error instanceof z.ZodError && error.errors) {
              const details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
              consoleLogger.error(`Validation error in ${file}`, { errors: error.errors });
              throw new ValidationError('TeamMetric', file, details);
            }
            throw error;
          }
        }
      } catch (err) {
        // Skip if not a directory or can't read
        continue;
      }
    }

    consoleLogger.info(`Loaded ${teamMetrics.length} team metrics`);
    return teamMetrics;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      consoleLogger.warn('Team metrics directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
