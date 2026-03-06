import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityMetric } from '../../../frontend/scripts/insights-data';
import { parseCapabilityMetricYaml } from '../../../parsers/yaml/metricParser';
import { getUserDataPath } from './userDataPaths';
import type { CapabilityMetricsRepository } from '../../../application/capabilityMetrics/Repository';

export class FilesystemCapabilityMetricsRepository implements CapabilityMetricsRepository {
  async listAll(): Promise<CapabilityMetric[]> {
    const dir = getUserDataPath('metrics', 'capability_scores');

    try {
      const files = await readdir(dir);

      const metrics = await Promise.all(
        files
          .filter(file => file.endsWith('.yaml'))
          .map(async file => {
            const filePath = join(dir, file);
            const content = await Bun.file(filePath).text();
            const metricFile = parseCapabilityMetricYaml(content, file);
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
}
