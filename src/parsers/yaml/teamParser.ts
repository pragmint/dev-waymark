import { parse } from 'yaml';
import { z } from 'zod';
import type { Team } from '../../core/data/teamTypes';
import { TeamSchema } from '../../core/data/teamTypes';
import { ValidationError } from '../../core/errors';

export function parseTeamYaml(content: string, filename: string): Team {
  const raw = parse(content);

  try {
    return TeamSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      console.log(`Validation error in ${filename}`, { errors: error.issues });
      throw new ValidationError('Team', filename, details);
    }
    throw error;
  }
}
