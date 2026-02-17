import { parse } from 'yaml';
import { z } from 'zod';
import type { Experiment } from '../../core/domain/experimentTypes';
import { ExperimentFileSchema } from '../../core/domain/experimentTypes';
import { ValidationError } from '../../core/domain/errors';

function filenameToTitle(filename: string): string {
  const lowercaseWords = new Set(['a', 'the', 'and', 'to', 'of', 'in']);

  return filename
    .split('-')
    .map((word, index) => {
      if (word === 'ai') return 'AI';
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      if (lowercaseWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function parseExperimentYaml(
  content: string,
  teamId: string,
  experimentId: string
): Experiment {
  const raw = parse(content);

  try {
    // Parse with runtime validation
    const experimentFile = ExperimentFileSchema.parse(raw);

    // Extract intervention fields
    const intervention = experimentFile.intervention;

    // Transform YAML structure to runtime Experiment structure
    return {
      id: experimentId,
      teamId: teamId,
      title: filenameToTitle(experimentId), // Title is always inferred from filename
      context: {
        problemStatement: experimentFile.context.problem_statement,
        desiredOutcome: experimentFile.context.desired_outcome,
      },
      hypothesis: {
        statement: experimentFile.hypothesis.statement,
        assumptions: experimentFile.hypothesis.assumptions,
        risks: experimentFile.hypothesis.risks,
        riskMitigations: experimentFile.hypothesis.risk_mitigations,
      },
      intervention: {
        practiceUnderTest: intervention.practice_under_test,
        description: intervention.description,
      },
      successCriteria: intervention.success_criteria,
      status: intervention.status,
      actionPlan: intervention['action-plan'],
      startDate: intervention['start-date'],
      expectedDurationInWeeks: intervention['expected-duration-in-weeks'],
      decisionRoles: experimentFile['decision-roles'],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      console.log(`Validation error for experiment ${experimentId}`, { errors: error.issues });
      throw new ValidationError('Experiment', `${teamId}/${experimentId}`, details);
    }
    throw error;
  }
}
