import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityMetric } from '../schemas/metricSchemas';
import { parseCapabilityMetricYaml } from '../parsers/yaml/metricParser';
import { getUserDataPath } from './userDataPaths';
import { isEnoentError } from './isEnoentError';

/**
 * Loads capability metrics from filesystem
 * Directory structure: {userData}/metrics/capability_scores/{capability-name}.yaml
 */
export async function loadCapabilityMetricsFromFilesystem(): Promise<CapabilityMetric[]> {
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
    if (isEnoentError(error)) {
      console.log('Capability metrics directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
