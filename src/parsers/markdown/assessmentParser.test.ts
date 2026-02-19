import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { MaturityLevel } from '../../schemas/capabilitySchemas';
//parseAssessmentMarkdown
// We need to mock `readFile` since parseAssessmentMarkdown reads from the filesystem.
// Instead, we test the parsing logic by providing controlled markdown content.
// The module reads a file then parses it, so we mock fs/promises.

const mockReadFile = mock<(path: string, encoding: string) => Promise<string>>(() =>
  Promise.resolve('')
);

mock.module('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

// Import after mocking so the module picks up the mock
const { parseAssessmentMarkdown } = await import('./assessmentParser');

beforeEach(() => {
  mockReadFile.mockClear();
});

describe('parseAssessmentMarkdown', () => {
  test('parses a simple capability with maturity levels', async () => {
    const markdown = `# Assessment

### [Continuous Integration](/capabilities/continuous-integration.md)

1. **Infrequent:** Integration is done rarely.
2. **Routine:** Integration happens regularly.
3. **Frequent:** Integration happens multiple times a day.
4. **Continuous:** Every commit triggers integration.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(1);
    const levels = result.get('continuous-integration')!;
    expect(levels).toHaveLength(4);
    expect(levels[0]).toEqual({
      level: 1,
      title: 'Infrequent',
      description: 'Integration is done rarely.',
      dimension: undefined,
    });
    expect(levels[3]).toEqual({
      level: 4,
      title: 'Continuous',
      description: 'Every commit triggers integration.',
      dimension: undefined,
    });
  });

  test('parses multiple capabilities', async () => {
    const markdown = `# Assessment

### [Cap A](/capabilities/cap-a.md)

1. **Low:** Description A1.
2. **High:** Description A2.

### [Cap B](/capabilities/cap-b.md)

1. **Low:** Description B1.
2. **High:** Description B2.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(2);
    expect(result.has('cap-a')).toBe(true);
    expect(result.has('cap-b')).toBe(true);
    expect(result.get('cap-a')!).toHaveLength(2);
    expect(result.get('cap-b')!).toHaveLength(2);
  });

  test('parses multi-dimension capability with H4 headers', async () => {
    const markdown = `# Assessment

### [Code Maintainability](/capabilities/code-maintainability.md)

#### New Code

1. **Growing Tech Debt:** Code is rarely refactored.
2. **Occasional Maintenance:** Teams sometimes prioritize features.

#### Previously Written Code

1. **Brittle Codebase:** Changing code is time-consuming.
2. **Well-organized Codebase:** Changes don't require much rework.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(1);
    const levels = result.get('code-maintainability')!;
    expect(levels).toHaveLength(4);

    const newCodeLevels = levels.filter((l: MaturityLevel) => l.dimension === 'New Code');
    const oldCodeLevels = levels.filter(
      (l: MaturityLevel) => l.dimension === 'Previously Written Code'
    );

    expect(newCodeLevels).toHaveLength(2);
    expect(oldCodeLevels).toHaveLength(2);

    expect(newCodeLevels[0]).toEqual({
      level: 1,
      title: 'Growing Tech Debt',
      description: 'Code is rarely refactored.',
      dimension: 'New Code',
    });
    expect(oldCodeLevels[1]).toEqual({
      level: 2,
      title: 'Well-organized Codebase',
      description: "Changes don't require much rework.",
      dimension: 'Previously Written Code',
    });
  });

  test('returns empty map when no capability sections exist', async () => {
    const markdown = `# Assessment

Just some introduction text without any capability sections.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(0);
  });

  test('skips capabilities with no maturity levels', async () => {
    const markdown = `# Assessment

### [Empty Cap](/capabilities/empty-cap.md)

No numbered maturity levels here, just text.

### [Valid Cap](/capabilities/valid-cap.md)

1. **Level One:** Description.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(1);
    expect(result.has('empty-cap')).toBe(false);
    expect(result.has('valid-cap')).toBe(true);
  });

  test('captures description up to end of line', async () => {
    const markdown = `# Assessment

### [Test Cap](/capabilities/test-cap.md)

1. **First:** This is a description.
2. **Second:** Short description.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    const levels = result.get('test-cap')!;
    expect(levels).toHaveLength(2);
    expect(levels[0].description).toBe('This is a description.');
    expect(levels[1].description).toBe('Short description.');
  });

  test('reads from the correct file path', async () => {
    mockReadFile.mockResolvedValueOnce('');
    await parseAssessmentMarkdown();

    expect(mockReadFile).toHaveBeenCalledWith(
      'resources/capabilities-maturity-assessment.md',
      'utf-8'
    );
  });

  test('handles capability with 3 dimensions', async () => {
    const markdown = `# Assessment

### [Delivery](/capabilities/delivery.md)

#### Speed

1. **Slow:** Takes months.
2. **Fast:** Takes hours.

#### Quality

1. **Low:** Many bugs.
2. **High:** Few bugs.

#### Reliability

1. **Poor:** Frequent outages.
2. **Excellent:** Minimal outages.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    const levels = result.get('delivery')!;
    expect(levels).toHaveLength(6);

    const speedLevels = levels.filter((l: MaturityLevel) => l.dimension === 'Speed');
    const qualityLevels = levels.filter((l: MaturityLevel) => l.dimension === 'Quality');
    const reliabilityLevels = levels.filter((l: MaturityLevel) => l.dimension === 'Reliability');

    expect(speedLevels).toHaveLength(2);
    expect(qualityLevels).toHaveLength(2);
    expect(reliabilityLevels).toHaveLength(2);
  });

  test('parses mixed simple and multi-dimension capabilities', async () => {
    const markdown = `# Assessment

### [Simple Cap](/capabilities/simple-cap.md)

1. **Low:** Basic level.
2. **High:** Advanced level.

### [Complex Cap](/capabilities/complex-cap.md)

#### Dimension A

1. **Low A:** Basic A.
2. **High A:** Advanced A.

#### Dimension B

1. **Low B:** Basic B.
2. **High B:** Advanced B.
`;

    mockReadFile.mockResolvedValueOnce(markdown);
    const result = await parseAssessmentMarkdown();

    expect(result.size).toBe(2);

    const simpleLevels = result.get('simple-cap')!;
    expect(simpleLevels).toHaveLength(2);
    expect(simpleLevels[0].dimension).toBeUndefined();

    const complexLevels = result.get('complex-cap')!;
    expect(complexLevels).toHaveLength(4);
    expect(complexLevels[0].dimension).toBe('Dimension A');
    expect(complexLevels[2].dimension).toBe('Dimension B');
  });
});
