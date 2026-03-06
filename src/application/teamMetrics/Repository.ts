import type { TeamMetric } from '../../schemas/metricSchemas';

export interface TeamMetricsRepository {
  listAll(): Promise<TeamMetric[]>;
}
