import type { CapabilityMetric } from '../../frontend/scripts/insights-data';

export interface CapabilityMetricsRepository {
  listAll(): Promise<CapabilityMetric[]>;
}
