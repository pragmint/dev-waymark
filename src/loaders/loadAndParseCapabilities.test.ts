import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

const mockReaddir = mock<() => Promise<string[]>>(() => Promise.resolve([]));
const mockReadFile = mock<() => Promise<string>>(() => Promise.resolve(''));
mock.module('node:fs/promises', () => ({
  ...realFs,
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

const { loadAndParseCapabilities } = await import('./loadAndParseCapabilities');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
});

const SIMPLE_CAPABILITY_MD = `# [Job Satisfaction](https://dora.dev/capabilities/job-satisfaction/)

Job Satisfaction refers to the level of contentment employees feel toward their work.

## Nuances

This section outlines common pitfalls.

### Lagging Indicator

Changes often occur after changes in underlying factors.

## Assessment

Assess how mature your team is in this capability.

1. **Unfulfilling Work:** Employees often feel undervalued.
2. **Limited Engagement:** Employees are somewhat satisfied.
3. **Satisfactory Engagement:** Employees are generally content.
4. **Exceptional Engagement:** Employees are highly motivated.

The number you selected represents your overall score.

## Supporting Practices

The following is a curated list of supporting practices.

### A Practice

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Job Satisfaction)
- Upstream (they are a pre-requisite for Job Satisfaction)
- Downstream (Job Satisfaction is a pre-requisite for them)

### [Well-being](/capabilities/well-being.md) - Related

Well-being description.
`;

const MULTI_DIMENSION_CAPABILITY_MD = `# [Code Maintainability](https://dora.dev/capabilities/code-maintainability/)

Introduction to code maintainability.

## Nuances

Nuance intro.

### A Nuance

Nuance content.

## Assessment

Assessment intro.

### New Code

1. **Growing Tech Debt:** Code is rarely refactored.
2. **Occasional Maintenance:** Teams sometimes prioritize delivery.
3. **Reactive Maintenance:** Code is maintained as problems arise.
4. **Proactive Maintenance:** Teams proactively refactor.

### Previously Written Code

1. **Brittle Codebase:** Changing code is time-consuming.
2. **Fairly Complex Codebase:** Most changes require refactoring.
3. **Partially Modular Codebase:** Most parts are modular.
4. **Well-organized Codebase:** Changes don't require much rework.

Assessment outro.

## Supporting Practices

Practices intro.

### Practice One

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Code Maintainability)
- Upstream (they are a pre-requisite for Code Maintainability)
- Downstream (Code Maintainability is a pre-requisite for them)

### [Testing](/capabilities/testing.md) - Upstream

Testing description.
`;

describe('loadAndParseCapabilities', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);
    spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('successfully loads all capability files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md', 'code-maintainability.md']);
    mockReadFile
      .mockResolvedValueOnce(SIMPLE_CAPABILITY_MD)
      .mockResolvedValueOnce(MULTI_DIMENSION_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toHaveLength(2);
  });

  it('correctly extracts ID from filename', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].id).toBe('job-satisfaction');
  });

  it('correctly maps title to name', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].name).toBe('Job Satisfaction');
  });

  it('correctly maps introduction to description', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].description).toBe(
      'Job Satisfaction refers to the level of contentment employees feel toward their work.'
    );
  });

  it('correctly transforms assessment ratings to maturity levels', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].maturityLevels).toHaveLength(4);
    expect(result[0].maturityLevels![0]).toEqual({
      level: 1,
      title: 'Unfulfilling Work',
      description: 'Employees often feel undervalued.',
    });
    expect(result[0].maturityLevels![3]).toEqual({
      level: 4,
      title: 'Exceptional Engagement',
      description: 'Employees are highly motivated.',
    });
  });

  it('sets default values for currentScore, trend, and teamsTargeting', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['job-satisfaction.md']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].currentScore).toBe(0);
    expect(result[0].trend).toBe('stable');
    expect(result[0].teamsTargeting).toBe(0);
  });

  it('preserves dimension information when present', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['code-maintainability.md']);
    mockReadFile.mockResolvedValue(MULTI_DIMENSION_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].maturityLevels).toHaveLength(8);
    expect(result[0].maturityLevels![0].dimension).toBe('New Code');
    expect(result[0].maturityLevels![4].dimension).toBe('Previously Written Code');
  });

  it('returns capabilities sorted by name', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['z-capability.md', 'a-capability.md']);
    const zebraCapability = `# [Zebra Capability](https://dora.dev/capabilities/zebra-capability/)

Introduction.

## Nuances

Nuances intro.

### Nuance

Nuance content.

## Assessment

Assessment intro.

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

Assessment outro.

## Supporting Practices

Practices intro.

### Practice

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Zebra Capability)
- Upstream (they are a pre-requisite for Zebra Capability)
- Downstream (Zebra Capability is a pre-requisite for them)

### [Other](/capabilities/other.md) - Related

Description.
`;
    const alphaCapability = `# [Alpha Capability](https://dora.dev/capabilities/alpha-capability/)

Introduction.

## Nuances

Nuances intro.

### Nuance

Nuance content.

## Assessment

Assessment intro.

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

Assessment outro.

## Supporting Practices

Practices intro.

### Practice

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Alpha Capability)
- Upstream (they are a pre-requisite for Alpha Capability)
- Downstream (Alpha Capability is a pre-requisite for them)

### [Other](/capabilities/other.md) - Related

Description.
`;
    mockReadFile.mockResolvedValueOnce(zebraCapability).mockResolvedValueOnce(alphaCapability);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result[0].name).toBe('Alpha Capability');
    expect(result[1].name).toBe('Zebra Capability');
  });

  it('filters out non-.md files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['capability.md', 'readme.txt', '.gitkeep']);
    mockReadFile.mockResolvedValue(SIMPLE_CAPABILITY_MD);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toEqual([]);
  });

  it('handles parse errors gracefully and continues processing', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['good.md', 'bad.md', 'also-good.md']);
    const anotherGood = `# [Another Good](https://dora.dev/capabilities/another-good/)

Introduction.

## Nuances

Nuances intro.

### Nuance

Nuance content.

## Assessment

Assessment intro.

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

Assessment outro.

## Supporting Practices

Practices intro.

### Practice

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Another Good)
- Upstream (they are a pre-requisite for Another Good)
- Downstream (Another Good is a pre-requisite for them)

### [Other](/capabilities/other.md) - Related

Description.
`;
    mockReadFile
      .mockResolvedValueOnce(SIMPLE_CAPABILITY_MD)
      .mockResolvedValueOnce('invalid markdown without required sections')
      .mockResolvedValueOnce(anotherGood);

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Another Good');
    expect(result[1].name).toBe('Job Satisfaction');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse capability file "bad.md"')
    );
  });

  it('handles file read errors gracefully', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['good.md', 'unreadable.md']);
    mockReadFile
      .mockResolvedValueOnce(SIMPLE_CAPABILITY_MD)
      .mockRejectedValueOnce(new Error('Permission denied'));

    // Act
    const result = await loadAndParseCapabilities();

    // Assert
    expect(result).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read capability file "unreadable.md"')
    );
  });

  it('reads files from the correct directory path', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadAndParseCapabilities();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('resources/capabilities');
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadAndParseCapabilities()).rejects.toThrow('EACCES');
  });
});
