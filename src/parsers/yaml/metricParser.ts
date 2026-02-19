import { parse } from 'yaml';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors';
import { MetricFileSchema, TeamMetricFileSchema } from '../../schemas/metricSchemas';
import type { MetricFile, TeamMetricFile } from '../../schemas/metricSchemas';

export function parseCapabilityMetricYaml(content: string, filename: string): MetricFile {
  const raw = parse(content);

  try {
    // The Zod transform normalizes arrays to Record<string, number>,
    // but TypeScript can't narrow the union in the else branch.
    // The cast is safe because the transform guarantees no arrays in output.
    return MetricFileSchema.parse(raw) as MetricFile;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      console.log(`Validation error in ${filename}`, { errors: error.issues });
      throw new ValidationError('Metric', filename, details);
    }
    throw error;
  }
}

export function parseTeamMetricYaml(content: string, filename: string): TeamMetricFile {
  const raw = parse(content);

  try {
    return TeamMetricFileSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      console.log(`Validation error in ${filename}`, { errors: error.issues });
      throw new ValidationError('TeamMetric', filename, details);
    }
    throw error;
  }
}
