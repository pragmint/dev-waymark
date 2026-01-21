import { parse } from 'yaml';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Team } from '../../core/data/teamTypes';

// Pure I/O function - loads teams from filesystem
export async function loadTeamsFromFilesystem(): Promise<Team[]> {
  const dir = 'resources/private/yaml/teams';
  const files = await readdir(dir);

  const teams = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async file => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        return parse(content) as Team;
      })
  );

  // Sort teams alphabetically by name
  teams.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Loaded ${teams.length} teams`);

  return teams;
}
