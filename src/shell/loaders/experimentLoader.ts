import { parse } from 'yaml';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Experiment } from '../../core/data/experimentTypes';
import { ExperimentFileSchema } from '../../core/data/experimentTypes';
import { ValidationError } from '../../core/errors';
import { consoleLogger } from '../../core/logger';
import { filenameToTitle } from '../../core/utils/stringUtils';

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
 * Pure I/O function - loads a single experiment from a file
 */
async function loadExperimentFromFile(
  filePath: string,
  teamId: string,
  experimentId: string
): Promise<Experiment> {
  const content = await Bun.file(filePath).text();
  const raw = parse(content);

  try {
    // Parse with runtime validation
    const experimentFile = ExperimentFileSchema.parse(raw);

    // Transform YAML structure to runtime Experiment structure
    return {
      id: experimentId,
      teamId: teamId,
      title: filenameToTitle(experimentId), // Title is always inferred from filename
      practice: experimentFile.practice,
      hypothesis: experimentFile.hypothesis,
      status: experimentFile.status,
      supportingEvidence: experimentFile['supporting-evidence'],
      actionPlan: experimentFile['action-plan'],
      startDate: experimentFile['start-date'],
      expectedDurationInWeeks: experimentFile['expected-duration-in-weeks'],
      decisionRoles: experimentFile['decision-roles'],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      consoleLogger.error(`Validation error in ${filePath}`, { errors: error.issues });
      throw new ValidationError('Experiment', filePath, details);
    }
    throw error;
  }
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

        const experiment = await loadExperimentFromFile(filePath, teamId, experimentId);
        experiments.push(experiment);
      }
    }

    consoleLogger.info(
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
      consoleLogger.warn('Experiments directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
