import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Experiment } from '../../core/data/experimentTypes';
import { parseExperimentYaml } from '../../parsers/yaml/experimentParser';

/**
 * Converts kebab-case filename to experiment ID
 * Example: "enforce-types-with-a-linter.yaml" -> "enforce-types-with-a-linter"
 */
function filenameToExperimentId(filename: string): string {
  return filename.replace('.yaml', '');
}

/**
 * Converts snake_case directory name to team ID
 * Example: "team_a" -> "team-a"
 */
function directoryToTeamId(dirname: string): string {
  return dirname.replace(/_/g, '-');
}

/**
 * Pure I/O function - loads experiments from filesystem with validation
 * Directory structure: experiments/{team_id}/{experiment-name}.yaml
 */
export async function loadExperimentsFromFilesystem(): Promise<Experiment[]> {
  const experimentsDir = 'resources/private/yaml/experiments';

  try {
    const teamDirs = await readdir(experimentsDir);
    const experiments: Experiment[] = [];

    // Process each team directory
    for (const teamDir of teamDirs) {
      const teamDirPath = join(experimentsDir, teamDir);

      // Skip non-directories (like .DS_Store)
      try {
        const stats = await stat(teamDirPath);
        if (!stats.isDirectory()) continue;
      } catch {
        continue;
      }

      const teamId = directoryToTeamId(teamDir);

      // Read experiment files in this team's directory
      const files = await readdir(teamDirPath);

      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;

        const filePath = join(teamDirPath, file);
        const experimentId = filenameToExperimentId(file);

        const content = await Bun.file(filePath).text();
        const experiment = parseExperimentYaml(content, teamId, experimentId);
        experiments.push(experiment);
      }
    }

    console.log(
      `Loaded ${experiments.length} experiments from ${
        teamDirs.filter(async d => {
          try {
            const stats = await stat(join(experimentsDir, d));
            return stats.isDirectory();
          } catch {
            return false;
          }
        }).length
      } teams`
    );
    return experiments;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Experiments directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
