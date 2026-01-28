import { parse } from 'yaml';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ValidationError } from '../../core/errors';
import { consoleLogger } from '../../core/logger';

// Zod schemas for metric data validation
export const MetricDataPointSchema = z.object({
  team: z.string(),
  date: z.string(), // Format: yy.m.dd or similar
  value: z.number().min(0).max(4),
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

/**
 * Pure I/O function - loads metrics from filesystem with validation
 * Each file corresponds to a capability and contains team scores over time
 */
export async function loadMetricsFromFilesystem(): Promise<Metric[]> {
  const dir = 'resources/private/yaml/metrics';

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
            if (error instanceof z.ZodError) {
              const details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
              consoleLogger.error(`Validation error in ${file}`, { errors: error.errors });
              throw new ValidationError('Metric', file, details);
            }
            throw error;
          }
        })
    );

    consoleLogger.info(`Loaded ${metrics.length} metrics`);

    return metrics;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      consoleLogger.warn('Metrics directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
