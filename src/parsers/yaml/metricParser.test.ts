import { describe, test, expect } from 'bun:test';
import { parseCapabilityMetricYaml, parseTeamMetricYaml } from './metricParser';
import { ValidationError } from '../../shell/middleware/errorHandler';

describe('parseCapabilityMetricYaml', () => {
  test('parses simple numeric values', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value: 3
  - team: team-b
    date: 28.1.2026
    value: 2.5
`;
    const result = parseCapabilityMetricYaml(yaml, 'ci.yaml');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({
      team: 'team-a',
      date: '28.1.2026',
      value: 3,
    });
    expect(result.data[1].value).toBe(2.5);
  });

  test('parses string values (anecdotes)', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value: "Improved significantly"
`;
    const result = parseCapabilityMetricYaml(yaml, 'metric.yaml');
    expect(result.data[0].value).toBe('Improved significantly');
  });

  test('parses numeric value with justification', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value: 2
    justification: "Still needs improvement in CI pipeline."
`;
    const result = parseCapabilityMetricYaml(yaml, 'metric.yaml');
    expect(result.data[0].value).toBe(2);
    expect(result.data[0].justification).toBe('Still needs improvement in CI pipeline.');
  });

  test('normalizes dimension score arrays to objects', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value:
      - new-code: 2
      - old-code: 3
`;
    const result = parseCapabilityMetricYaml(yaml, 'maintainability.yaml');
    expect(result.data[0].value).toEqual({ 'new-code': 2, 'old-code': 3 });
  });

  test('normalizes dimension score arrays with justifications', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value:
      - new-code: 2
        justification: "Needs work"
      - old-code: 3
        justification: "Getting better"
`;
    const result = parseCapabilityMetricYaml(yaml, 'maintainability.yaml');
    expect(result.data[0].value).toEqual({ 'new-code': 2, 'old-code': 3 });
    expect(result.data[0].dimensionJustifications).toEqual({
      'new-code': 'Needs work',
      'old-code': 'Getting better',
    });
  });

  test('dimension array items without justification have no dimensionJustifications', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value:
      - new-code: 2
      - old-code: 3
`;
    const result = parseCapabilityMetricYaml(yaml, 'metric.yaml');
    expect(result.data[0].dimensionJustifications).toBeUndefined();
  });

  test('parses record-style dimension scores (already object)', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value:
      new-code: 2
      old-code: 3
`;
    const result = parseCapabilityMetricYaml(yaml, 'metric.yaml');
    expect(result.data[0].value).toEqual({ 'new-code': 2, 'old-code': 3 });
  });

  test('team field is optional', () => {
    const yaml = `
data:
  - date: 28.1.2026
    value: 3
`;
    const result = parseCapabilityMetricYaml(yaml, 'metric.yaml');
    expect(result.data[0].team).toBeUndefined();
  });

  test('parses multiple data points', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
    value: 3
  - team: team-a
    date: 27.1.2026
    value: 2
  - team: team-b
    date: 28.1.2026
    value: 4
`;
    const result = parseCapabilityMetricYaml(yaml, 'ci.yaml');
    expect(result.data).toHaveLength(3);
  });

  test('throws ValidationError when data array is missing', () => {
    const yaml = `
something_else: true
`;
    expect(() => parseCapabilityMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('throws ValidationError when date is missing from data point', () => {
    const yaml = `
data:
  - team: team-a
    value: 3
`;
    expect(() => parseCapabilityMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('throws ValidationError when value is missing', () => {
    const yaml = `
data:
  - team: team-a
    date: 28.1.2026
`;
    expect(() => parseCapabilityMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('ValidationError includes filename and details', () => {
    const yaml = `
data:
  - team: team-a
`;
    try {
      parseCapabilityMetricYaml(yaml, 'broken-metric.yaml');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fileName).toBe('broken-metric.yaml');
      expect(ve.resourceType).toBe('Metric');
    }
  });

  test('handles empty data array', () => {
    const yaml = `
data: []
`;
    const result = parseCapabilityMetricYaml(yaml, 'empty.yaml');
    expect(result.data).toEqual([]);
  });
});

describe('parseTeamMetricYaml', () => {
  test('parses numeric values', () => {
    const yaml = `
data:
  - date: 27.1.2026
    value: 1093
  - date: 26.1.2026
    value: 1451
`;
    const result = parseTeamMetricYaml(yaml, 'linter-errors.yaml');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({ date: '27.1.2026', value: 1093 });
    expect(result.data[1]).toEqual({ date: '26.1.2026', value: 1451 });
  });

  test('parses string values', () => {
    const yaml = `
data:
  - date: 27.1.2026
    value: "high"
`;
    const result = parseTeamMetricYaml(yaml, 'sentiment.yaml');
    expect(result.data[0].value).toBe('high');
  });

  test('throws ValidationError when data is missing', () => {
    const yaml = `
not_data: true
`;
    expect(() => parseTeamMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('throws ValidationError when date is missing', () => {
    const yaml = `
data:
  - value: 42
`;
    expect(() => parseTeamMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('throws ValidationError when value is missing', () => {
    const yaml = `
data:
  - date: 27.1.2026
`;
    expect(() => parseTeamMetricYaml(yaml, 'bad.yaml')).toThrow(ValidationError);
  });

  test('ValidationError includes filename and details', () => {
    const yaml = `
data:
  - missing_fields: true
`;
    try {
      parseTeamMetricYaml(yaml, 'broken.yaml');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fileName).toBe('broken.yaml');
      expect(ve.resourceType).toBe('TeamMetric');
    }
  });

  test('handles empty data array', () => {
    const yaml = `
data: []
`;
    const result = parseTeamMetricYaml(yaml, 'empty.yaml');
    expect(result.data).toEqual([]);
  });
});
