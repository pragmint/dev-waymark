import { describe, test, expect } from 'bun:test';
import { parseExperimentYaml } from './experimentParser';
import { ValidationError } from '../../domain/errors';

const minimalExperimentYaml = `
context:
  problem_statement: "Builds are slow"
  desired_outcome: "Faster builds"
hypothesis:
  statement: "Caching will speed things up"
intervention:
  practice_under_test: trunk-based-development
  description: "Adopt trunk-based development"
  status: active
`;

describe('parseExperimentYaml', () => {
  test('parses a minimal experiment', () => {
    const result = parseExperimentYaml(minimalExperimentYaml, 'team-a', 'speed-up-builds');

    expect(result.id).toBe('speed-up-builds');
    expect(result.teamId).toBe('team-a');
    expect(result.context.problemStatement).toBe('Builds are slow');
    expect(result.context.desiredOutcome).toBe('Faster builds');
    expect(result.hypothesis.statement).toBe('Caching will speed things up');
    expect(result.intervention.practiceUnderTest).toBe('trunk-based-development');
    expect(result.intervention.description).toBe('Adopt trunk-based development');
    expect(result.status).toBe('active');
  });

  test('infers title from experiment ID using title case', () => {
    const result = parseExperimentYaml(minimalExperimentYaml, 'team-a', 'speed-up-builds');
    expect(result.title).toBe('Speed Up Builds');
  });

  test('title keeps lowercase words like "a", "the", "and" except at start', () => {
    const result = parseExperimentYaml(minimalExperimentYaml, 'team-a', 'add-a-linter-to-the-repo');
    expect(result.title).toBe('Add a Linter to the Repo');
  });

  test('title capitalizes AI specially', () => {
    const result = parseExperimentYaml(minimalExperimentYaml, 'team-a', 'integrate-ai-code-review');
    expect(result.title).toBe('Integrate AI Code Review');
  });

  test('parses hypothesis with assumptions, risks, and mitigations', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
  assumptions:
    - "Team has bandwidth"
    - "Tools are available"
  risks:
    - "May slow down sprints"
  risk_mitigations:
    - "Allocate buffer time"
intervention:
  practice_under_test: pair-programming
  description: "Try pairing"
  status: pitch
`;
    const result = parseExperimentYaml(yaml, 'team-b', 'try-pairing');

    expect(result.hypothesis.assumptions).toEqual(['Team has bandwidth', 'Tools are available']);
    expect(result.hypothesis.risks).toEqual(['May slow down sprints']);
    expect(result.hypothesis.riskMitigations).toEqual(['Allocate buffer time']);
  });

  test('parses success criteria', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "Adopt TDD"
  status: active
  success_criteria:
    - metric: "Test coverage"
      target: "80%"
      measurement_window: during_experiment
    - metric: "Bug count"
      target: "< 5 per sprint"
      measurement_window: after_experiment
      notes: "Track for 2 sprints after"
`;
    const result = parseExperimentYaml(yaml, 'team-a', 'adopt-tdd');

    expect(result.successCriteria).toHaveLength(2);
    expect(result.successCriteria![0]).toEqual({
      metric: 'Test coverage',
      target: '80%',
      measurement_window: 'during_experiment',
    });
    expect(result.successCriteria![1].notes).toBe('Track for 2 sprints after');
  });

  test('parses action plan', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: ci-cd
  description: "Set up CI/CD"
  status: active
  action-plan:
    - title: "Configure pipeline"
      assigned-to:
        - Alice
      link: https://jira.example.com/123
      status: active
    - title: "Write tests"
      status: backlog
`;
    const result = parseExperimentYaml(yaml, 'team-a', 'setup-ci');

    expect(result.actionPlan).toHaveLength(2);
    expect(result.actionPlan![0].title).toBe('Configure pipeline');
    expect(result.actionPlan![0]['assigned-to']).toEqual(['Alice']);
    expect(result.actionPlan![0].link).toBe('https://jira.example.com/123');
    expect(result.actionPlan![0].status).toBe('active');
    expect(result.actionPlan![1].link).toBeUndefined();
  });

  test('parses start date and expected duration', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: pairing
  description: "Pair programming"
  status: active
  start-date: "14.1.2026"
  expected-duration-in-weeks: 12
`;
    const result = parseExperimentYaml(yaml, 'team-a', 'pairing-trial');

    expect(result.startDate).toBe('14.1.2026');
    expect(result.expectedDurationInWeeks).toBe(12);
  });

  test('parses decision roles', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: active
decision-roles:
  - responsible:
      - Alice
    accountable:
      - Bob
    consulted:
      - Carol
    informed:
      - Dave
`;
    const result = parseExperimentYaml(yaml, 'team-a', 'tdd-trial');

    expect(result.decisionRoles).toHaveLength(1);
    expect(result.decisionRoles![0].responsible).toEqual(['Alice']);
    expect(result.decisionRoles![0].accountable).toEqual(['Bob']);
    expect(result.decisionRoles![0].consulted).toEqual(['Carol']);
    expect(result.decisionRoles![0].informed).toEqual(['Dave']);
  });

  test('optional fields default to undefined when absent', () => {
    const result = parseExperimentYaml(minimalExperimentYaml, 'team-a', 'test-exp');

    expect(result.hypothesis.assumptions).toBeUndefined();
    expect(result.hypothesis.risks).toBeUndefined();
    expect(result.hypothesis.riskMitigations).toBeUndefined();
    expect(result.successCriteria).toBeUndefined();
    expect(result.actionPlan).toBeUndefined();
    expect(result.startDate).toBeUndefined();
    expect(result.expectedDurationInWeeks).toBeUndefined();
    expect(result.decisionRoles).toBeUndefined();
  });

  test('handles null start-date', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: active
  start-date: null
`;
    const result = parseExperimentYaml(yaml, 'team-a', 'tdd-trial');
    expect(result.startDate).toBeNull();
  });

  test('parses all valid status values', () => {
    const statuses = ['active', 'backlog', 'blocked', 'pitch', 'polish'] as const;

    for (const status of statuses) {
      const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "Statement"
intervention:
  practice_under_test: some-practice
  description: "Desc"
  status: ${status}
`;
      const result = parseExperimentYaml(yaml, 'team-a', 'exp');
      expect(result.status).toBe(status);
    }
  });

  test('throws ValidationError when context is missing', () => {
    const yaml = `
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: active
`;
    expect(() => parseExperimentYaml(yaml, 'team-a', 'bad')).toThrow(ValidationError);
  });

  test('throws ValidationError when hypothesis is missing', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: active
`;
    expect(() => parseExperimentYaml(yaml, 'team-a', 'bad')).toThrow(ValidationError);
  });

  test('throws ValidationError when intervention is missing', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
`;
    expect(() => parseExperimentYaml(yaml, 'team-a', 'bad')).toThrow(ValidationError);
  });

  test('throws ValidationError for invalid status', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: invalid-status
`;
    expect(() => parseExperimentYaml(yaml, 'team-a', 'bad')).toThrow(ValidationError);
  });

  test('ValidationError includes team/experiment path and details', () => {
    const yaml = `
context:
  problem_statement: "Problem"
`;
    try {
      parseExperimentYaml(yaml, 'team-x', 'broken-exp');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.resourceType).toBe('Experiment');
      expect(ve.fileName).toBe('team-x/broken-exp');
    }
  });

  test('throws ValidationError for invalid measurement_window', () => {
    const yaml = `
context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "It will work"
intervention:
  practice_under_test: tdd
  description: "TDD"
  status: active
  success_criteria:
    - metric: "Coverage"
      target: "80%"
      measurement_window: invalid_window
`;
    expect(() => parseExperimentYaml(yaml, 'team-a', 'bad')).toThrow(ValidationError);
  });
});
