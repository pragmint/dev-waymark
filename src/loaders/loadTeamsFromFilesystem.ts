import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Team } from '../schemas/teamSchemas';
import { parseTeamYaml } from '../parsers/yaml/teamParser';
import { getUserDataPath } from './userDataPaths';
import { isEnoentError } from './isEnoentError';

/**
 * Loads teams from filesystem
 * Directory structure: {userData}/teams/{team-name}.yaml
 */
export async function loadTeamsFromFilesystem(): Promise<Team[]> {
  const dir = getUserDataPath('teams');

  try {
    const files = await readdir(dir);

    const teams = await Promise.all(
      files
        .filter(file => file.endsWith('.yaml'))
        .map(async file => {
          const filePath = join(dir, file);
          const content = await Bun.file(filePath).text();
          return parseTeamYaml(content, file);
        })
    );

    teams.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Loaded ${teams.length} teams`);

    return teams;
  } catch (error) {
    if (isEnoentError(error)) {
      console.log('Teams directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
