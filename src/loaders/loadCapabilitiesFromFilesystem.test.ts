import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

// Mock node:fs/promises — spread real module to preserve exports for other test files
const mockReaddir = mock<() => Promise<string[]>>(() => Promise.resolve([]));
mock.module('node:fs/promises', () => ({
  ...realFs,
  readdir: mockReaddir,
}));

const { loadCapabilitiesFromFilesystem } = await import('./loadCapabilitiesFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
});

describe('loadCapabilitiesFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns capabilities derived from .md filenames', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['ci-cd.md', 'testing.md']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'ci-cd',
      name: 'Ci Cd',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    });
    expect(result[1]).toEqual({
      id: 'testing',
      name: 'Testing',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    });
  });

  it('filters out non-.md files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['ci-cd.md', 'notes.txt', '.DS_Store', 'readme.yaml']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ci-cd');
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const permissionError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(permissionError);

    // Act & Assert
    expect(loadCapabilitiesFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('rethrows errors without a code property', async () => {
    // Arrange
    mockReaddir.mockRejectedValue(new Error('unexpected'));

    // Act & Assert
    expect(loadCapabilitiesFromFilesystem()).rejects.toThrow('unexpected');
  });

  it('converts "ai" to uppercase "AI" in title', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['ai-assisted-testing.md']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result[0].name).toBe('AI Assisted Testing');
  });

  it('lowercases articles and prepositions in title (except first word)', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['adoption-of-the-practice.md']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result[0].name).toBe('Adoption of the Practice');
  });

  it('capitalizes first word even if it is a lowercase word', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['a-new-approach.md']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result[0].name).toBe('A New Approach');
  });

  it('handles single-word filenames', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['observability.md']);

    // Act
    const result = await loadCapabilitiesFromFilesystem();

    // Assert
    expect(result[0].id).toBe('observability');
    expect(result[0].name).toBe('Observability');
  });

  it('reads from the correct directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadCapabilitiesFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('resources/capabilities');
  });
});
