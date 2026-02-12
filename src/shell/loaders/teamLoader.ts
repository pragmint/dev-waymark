import { parse } from 'yaml';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Team } from '../../core/data/teamTypes';
import { TeamSchema } from '../../core/data/teamTypes';
import { ValidationError } from '../../core/errors';

// Pure I/O function - loads teams from filesystem with validation
export async function loadTeamsFromFilesystem(): Promise<Team[]> {
  const dir = 'resources/private/yaml/teams';
  const files = await readdir(dir);

  const teams = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async file => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        const raw = parse(content);

        try {
          // Parse with runtime validation
          return TeamSchema.parse(raw);
        } catch (error) {
          if (error instanceof z.ZodError) {
            const details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            console.log(`Validation error in ${file}`, { errors: error.errors });
            throw new ValidationError('Team', file, details);
          }
          throw error;
        }
      })
  );

  // Sort teams alphabetically by name
  teams.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Loaded ${teams.length} teams`);

  return teams;
}
