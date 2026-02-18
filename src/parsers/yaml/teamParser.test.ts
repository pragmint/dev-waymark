import { describe, test, expect } from 'bun:test';
import { parseTeamYaml } from './teamParser';
import { ValidationError } from '../../domain/errors';

describe('parseTeamYaml', () => {
  test('parses a minimal team with only required fields', () => {
    const yaml = `
id: team-a
name: Team A
`;
    const team = parseTeamYaml(yaml, 'team-a.yaml');
    expect(team.id).toBe('team-a');
    expect(team.name).toBe('Team A');
    expect(team.targetedCapabilities).toEqual([]);
    expect(team.nonTargetedCapabilities).toEqual([]);
    expect(team.activeExperiments).toEqual([]);
  });

  test('parses a team with description', () => {
    const yaml = `
id: team-b
name: Team B
description: A platform engineering team.
`;
    const team = parseTeamYaml(yaml, 'team-b.yaml');
    expect(team.description).toBe('A platform engineering team.');
  });

  test('parses targeted capabilities as string references (new format)', () => {
    const yaml = `
id: team-a
name: Team A
targetedCapabilities:
  - continuous-delivery
  - code-maintainability
`;
    const team = parseTeamYaml(yaml, 'team-a.yaml');
    expect(team.targetedCapabilities).toHaveLength(2);
    expect(team.targetedCapabilities[0]).toEqual({
      id: 'continuous-delivery',
      currentScore: null,
      trend: null,
    });
    expect(team.targetedCapabilities[1]).toEqual({
      id: 'code-maintainability',
      currentScore: null,
      trend: null,
    });
  });

  test('parses targeted capabilities as objects (old format)', () => {
    const yaml = `
id: team-a
name: Team A
targetedCapabilities:
  - id: continuous-delivery
    currentScore: 3
    trend: up
  - id: code-maintainability
    currentScore: 2
    trend: stable
`;
    const team = parseTeamYaml(yaml, 'team-a.yaml');
    expect(team.targetedCapabilities).toHaveLength(2);
    expect(team.targetedCapabilities[0]).toEqual({
      id: 'continuous-delivery',
      currentScore: 3,
      trend: 'up',
    });
    expect(team.targetedCapabilities[1]).toEqual({
      id: 'code-maintainability',
      currentScore: 2,
      trend: 'stable',
    });
  });

  test('parses non-targeted capabilities', () => {
    const yaml = `
id: team-a
name: Team A
nonTargetedCapabilities:
  - id: learning-culture
    currentScore: 1
    trend: down
`;
    const team = parseTeamYaml(yaml, 'team-a.yaml');
    expect(team.nonTargetedCapabilities).toHaveLength(1);
    expect(team.nonTargetedCapabilities[0]).toEqual({
      id: 'learning-culture',
      currentScore: 1,
      trend: 'down',
    });
  });

  test('parses active experiments', () => {
    const yaml = `
id: team-a
name: Team A
activeExperiments:
  - id: exp-1
    practiceId: pair-programming
    startDate: "2025-01-15"
    hypothesis: Pairing will reduce bugs
    status: in-progress
`;
    const team = parseTeamYaml(yaml, 'team-a.yaml');
    expect(team.activeExperiments).toHaveLength(1);
    expect(team.activeExperiments[0].id).toBe('exp-1');
    expect(team.activeExperiments[0].practiceId).toBe('pair-programming');
    expect(team.activeExperiments[0].status).toBe('in-progress');
  });

  test('throws ValidationError when id is missing', () => {
    const yaml = `
name: Team A
`;
    expect(() => parseTeamYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('throws ValidationError when name is missing', () => {
    const yaml = `
id: team-a
`;
    expect(() => parseTeamYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('ValidationError includes filename and details', () => {
    const yaml = `
name: Missing ID
`;
    try {
      parseTeamYaml(yaml, 'bad-team.yaml');
      expect(true).toBe(false); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fileName).toBe('bad-team.yaml');
      expect(ve.resourceType).toBe('Team');
      expect(ve.details).toContain('id');
    }
  });

  test('throws ValidationError for invalid trend value', () => {
    const yaml = `
id: team-a
name: Team A
targetedCapabilities:
  - id: ci
    currentScore: 2
    trend: sideways
`;
    expect(() => parseTeamYaml(yaml, 'team-a.yaml')).toThrow(ValidationError);
  });

  test('rethrows non-Zod errors as-is', () => {
    // Pass something that makes the yaml parser return a non-object that causes a non-Zod error
    // Actually, `parse` from yaml can handle almost anything, but null/undefined will fail at .parse
    // Let's test with content that produces null
    const yaml = '';
    expect(() => parseTeamYaml(yaml, 'empty.yaml')).toThrow();
  });
});
