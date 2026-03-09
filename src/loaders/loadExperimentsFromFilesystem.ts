import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Experiment } from '../schemas/experimentSchemas';
import { parseExperimentYaml } from '../parsers/yaml/experimentParser';
import { getUserDataPath } from './userDataPaths';
import { isEnoentError } from './isEnoentError';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
/**
 * Loads experiments from filesystem
 * Directory structure: {userData}/experiments/{team_id}/{experiment-name}.yaml
 */
export async function loadExperimentsFromFilesystem(): Promise<Experiment[]> {
  const dir = getUserDataPath('experiments');

  try {
    const teamDirs = await readdir(dir);
    const experiments: Experiment[] = [];

    for (const teamDir of teamDirs) {
      const teamDirPath = join(dir, teamDir);

      if (!(await isDirectory(teamDirPath))) continue;

      const teamId = teamDir.replace(/_/g, '-');
      const files = await readdir(teamDirPath);

      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;

        const filePath = join(teamDirPath, file);
        const experimentId = file.replace('.yaml', '');

        const content = await Bun.file(filePath).text();
        const experiment = parseExperimentYaml(content, teamId, experimentId);
        experiments.push(experiment);
      }
    }

    console.log(`Loaded ${experiments.length} experiments`);

    return experiments;
  } catch (error) {
    if (isEnoentError(error)) {
      console.log('Experiments directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
