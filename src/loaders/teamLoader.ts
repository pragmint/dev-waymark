import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Team } from '../core/data/teamTypes';
import { parseTeamYaml } from '../parsers/yaml/teamParser';

// Pure I/O function - loads teams from filesystem with validation
export async function loadTeamsFromFilesystem(): Promise<Team[]> {
  const dir = 'examples/teams';
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

  // Sort teams alphabetically by name
  teams.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Loaded ${teams.length} teams`);

  return teams;
}
