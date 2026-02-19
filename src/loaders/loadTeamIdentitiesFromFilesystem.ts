import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeamIdentity } from '../schemas/teamSchemas';
import { TeamIdentitySchema } from '../schemas/teamSchemas';
import { parse } from 'yaml';

/**
 * Loads only team identities (id + name) from filesystem.
 * Lightweight alternative to loadTeamsFromFilesystem for cases
 * that only need team identifiers (e.g. sidebar navigation).
     */
export async function loadTeamIdentitiesFromFilesystem(): Promise<TeamIdentity[]> {
  const dir = 'examples/teams';

  try {
    const files = await readdir(dir);

    const teams = await Promise.all(
      files
        .filter(file => file.endsWith('.yaml'))
        .map(async file => {
          const filePath = join(dir, file);
          const content = await Bun.file(filePath).text();
          const raw = parse(content);
          return TeamIdentitySchema.parse(raw);
        })
    );

    teams.sort((a, b) => a.name.localeCompare(b.name));

    console.log('Loaded Team Identities');
    return teams;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Teams directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
