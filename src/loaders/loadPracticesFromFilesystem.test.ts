import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

const mockReaddir = mock<(path: string) => Promise<string[]>>(() => Promise.resolve([]));
mock.module('node:fs/promises', () => ({
  ...realFs,
  readdir: mockReaddir,
}));

const mockText = mock<() => Promise<string>>(() => Promise.resolve('# Default\nContent'));
const savedBunFile = Bun.file.bind(Bun);
Bun.file = mock((path: string | URL) => {
  const real = savedBunFile(path);
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'text') return mockText;
      return Reflect.get(target, prop);
    },
  });
}) as unknown as typeof Bun.file;

const { loadPracticesFromFilesystem } = await import('./loadPracticesFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

describe('loadPracticesFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockText.mockReset();
    mockText.mockResolvedValue('# Default\nContent');
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads practices for each .md file in the directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['tdd.md', 'refactor.md']);
    mockText
      .mockResolvedValueOnce('# Implement TDD\nContent')
      .mockResolvedValueOnce('# Refactor\nContent');

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toHaveLength(2);
  });

  it('strips .md extension to get practice ID', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['conduct-code-reviews.md']);
    mockText.mockResolvedValue('# Conduct Code Reviews\nContent');

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result[0].id).toBe('conduct-code-reviews');
  });

  it('filters out non-.md files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['tdd.md', 'readme.txt', '.gitkeep']);
    mockText.mockResolvedValue('# TDD\nContent');

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('filters out null results from failed practice loads', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['good.md', 'broken.md']);
    mockText
      .mockResolvedValueOnce('# Good Practice\nContent')
      .mockRejectedValueOnce(new Error('File not found'));

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good');
  });

  it('sorts practices alphabetically by title', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['z-practice.md', 'a-practice.md']);
    mockText
      .mockResolvedValueOnce('# Zebra Practice\nContent')
      .mockResolvedValueOnce('# Alpha Practice\nContent');

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result[0].title).toBe('Alpha Practice');
    expect(result[1].title).toBe('Zebra Practice');
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadPracticesFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('reads from the correct directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadPracticesFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('resources/practices');
  });

  it('returns empty array when all practice loads fail', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['a.md', 'b.md']);
    mockText.mockRejectedValue(new Error('File not found'));

    // Act
    const result = await loadPracticesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });
});
