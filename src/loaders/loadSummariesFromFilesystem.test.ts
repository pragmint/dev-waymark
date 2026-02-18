import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';
import { ValidationError } from '../domain/errors';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

const mockReaddir = mock<() => Promise<string[]>>(() => Promise.resolve([]));
mock.module('node:fs/promises', () => ({
  ...realFs,
  readdir: mockReaddir,
}));

const mockText = mock<() => Promise<string>>(() => Promise.resolve(''));
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

const { loadSummariesFromFilesystem } = await import('./loadSummariesFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

describe('loadSummariesFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockText.mockReset();
    mockText.mockResolvedValue('# Summary content');
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads summaries from .md files with date-formatted names', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['16.1.2026.md']);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('16.1.2026');
    expect(result[0].dateString).toBe('16.1.2026');
    expect(result[0].htmlContent).toContain('Summary content');
    expect(result[0].filePath).toBe('resources/summaries/16.1.2026.md');
  });

  it('sorts summaries by date in descending order (newest first)', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['9.1.2026.md', '23.1.2026.md', '16.1.2026.md']);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toHaveLength(3);
    expect(result[0].dateString).toBe('23.1.2026');
    expect(result[1].dateString).toBe('16.1.2026');
    expect(result[2].dateString).toBe('9.1.2026');
  });

  it('filters out non-.md files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['16.1.2026.md', 'notes.txt', '.gitkeep']);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('parses markdown content to HTML for each summary', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['16.1.2026.md']);
    mockText.mockResolvedValue('# Week 3 Summary\n\nSome details here.');

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result[0].htmlContent).toContain('Week 3 Summary');
    expect(result[0].htmlContent).toContain('Some details here');
  });

  it('throws ValidationError for invalid date format in filename', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['not-a-date.md']);

    // Act & Assert
    expect(loadSummariesFromFilesystem()).rejects.toThrow(ValidationError);
  });

  it('ValidationError includes filename and format guidance', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['invalid.md']);

    // Act & Assert
    try {
      await loadSummariesFromFilesystem();
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.resourceType).toBe('Summary');
      expect(ve.fileName).toBe('invalid.md');
      expect(ve.details).toContain('dd.mm.yyyy');
    }
  });

  it('accepts single-digit day and month in filename', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['9.1.2026.md']);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].dateString).toBe('9.1.2026');
  });

  it('accepts double-digit day and month in filename', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['16.01.2026.md']);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].dateString).toBe('16.01.2026');
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadSummariesFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadSummariesFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('reads from the correct directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadSummariesFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('resources/summaries');
  });
});
