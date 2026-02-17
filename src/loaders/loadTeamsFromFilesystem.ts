import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Team } from '../core/data/teamTypes';
import { parseTeamYaml } from '../parsers/yaml/teamParser';

/**
 * Loads teams from filesystem
 * Directory structure: examples/teams/{team-name}.yaml
 */
export async function loadTeamsFromFilesystem(): Promise<Team[]> {
  const dir = 'examples/teams';

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
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Teams directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
