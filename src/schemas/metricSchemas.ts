import { z } from 'zod';

// Zod schemas for capability metric data validation
// Value can be:
// - A number (simple score)
// - A string (anecdotes)
// - An array of single-key objects (dimension scores from YAML)
// - A record object (dimension scores)
const DimensionScoreSchema = z.record(z.string(), z.number());
const DimensionScoreArraySchema = z.array(z.record(z.string(), z.union([z.number(), z.string()])));

export const MetricDataPointSchema = z
  .object({
    team: z.string().optional(),
    date: z.string(), // Format: yy.m.dd or similar
    value: z.union([z.number(), z.string(), DimensionScoreArraySchema, DimensionScoreSchema]),
    justification: z.string().optional(),
  })
  .transform(data => {
    // Normalize dimension score arrays to single objects
    // YAML arrays like [{"new-code": 1, "justification": "..."}, {"old-code": 2}]
    // -> {scores: {"new-code": 1, "old-code": 2}, justifications: {"new-code": "..."}}
    if (Array.isArray(data.value)) {
      const normalized: Record<string, number> = {};
      const justifications: Record<string, string> = {};

      for (const item of data.value) {
        // Extract dimension name (the key that's not 'justification')
        const dimensionKey = Object.keys(item).find(k => k !== 'justification');
        if (dimensionKey && typeof item[dimensionKey] === 'number') {
          normalized[dimensionKey] = item[dimensionKey];
          if (item.justification && typeof item.justification === 'string') {
            justifications[dimensionKey] = item.justification;
          }
        }
      }

      return {
        ...data,
        value: normalized,
        dimensionJustifications:
          Object.keys(justifications).length > 0 ? justifications : undefined,
      };
    }
    return data;
  });

export const MetricFileSchema = z.object({
  data: z.array(MetricDataPointSchema),
});

export type MetricValue = number | string | Record<string, number>;

export interface MetricDataPoint {
  team?: string;
  date: string;
  value: MetricValue;
  justification?: string;
  dimensionJustifications?: Record<string, string>;
}

export type MetricFile = { data: MetricDataPoint[] };

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
