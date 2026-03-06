import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeamMetric } from '../../../schemas/metricSchemas';
import { parseTeamMetricYaml } from '../../../parsers/yaml/metricParser';
import { getUserDataPath } from './userDataPaths';
import type { TeamMetricsRepository } from '../../../application/teamMetrics/Repository';

export class FilesystemTeamMetricsRepository implements TeamMetricsRepository {
  async listAll(): Promise<TeamMetric[]> {
    const dir = getUserDataPath('metrics', 'team_specific');

    try {
      const teamDirs = await readdir(dir);
      const teamMetrics: TeamMetric[] = [];

      for (const teamDir of teamDirs) {
        const teamDirPath = join(dir, teamDir);

        try {
          const files = await readdir(teamDirPath);
          const teamId = teamDir.replace(/_/g, '-');

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
}
