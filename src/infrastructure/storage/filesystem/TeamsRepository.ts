import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Team, TeamIdentity } from '../../../schemas/teamSchemas';
import { TeamIdentitySchema } from '../../../schemas/teamSchemas';
import { parseTeamYaml } from '../../../parsers/yaml/teamParser';
import { getUserDataPath } from './userDataPaths';
import type { TeamsRepository } from '../../../application/teams/Repository';

export class FilesystemTeamsRepository implements TeamsRepository {
  async listAll(): Promise<Team[]> {
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
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        console.log('Teams directory not found, returning empty array');
        return [];
      }
      throw error;
    }
  }

  async listIdentities(): Promise<TeamIdentity[]> {
    const dir = getUserDataPath('teams');

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
}
