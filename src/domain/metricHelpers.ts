import type { MetricValue } from '../schemas/metricSchemas';
import type { TrendDirection } from '../schemas/capabilitySchemas';

/**
 * Convert metric value to number, handling dimension scores and string values.
 * Returns null for non-numeric strings or empty objects.
 */
export function getNumericValue(value: number | string | Record<string, number>): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null) {
    const values = Object.values(value);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  return null;
}

/**
 * Helper function to check if a value is a dimension score object
 */
export function isDimensionScore(value: MetricValue): value is Record<string, number> {
  return typeof value === 'object' && !Array.isArray(value) && value !== null;
}

/**
 * Helper function to calculate average score from a metric value
 * If the value is a dimension score object, returns the average across all dimensions
 * Otherwise, returns the value as-is if it's a number, or 0 if it's a string
 */
export function getNumericScore(value: MetricValue): number {
  if (typeof value === 'number') {
    return value;
  }
  if (isDimensionScore(value)) {
    const scores = Object.values(value);
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  return 0; // String values or other types default to 0
}

export function calculateTrend(sortedData: { value: MetricValue }[]): TrendDirection {
  if (sortedData.length >= 2) {
    const scoreDiff = getNumericScore(sortedData[0].value) - getNumericScore(sortedData[1].value);
    if (scoreDiff > 0) return 'up';
    if (scoreDiff < 0) return 'down';
  }
  return 'stable';
}
