import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';

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

const { loadPracticeFromFilesystem } = await import('./loadPracticeFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

describe('loadPracticeFromFilesystem', () => {
  beforeEach(() => {
    mockText.mockReset();
    mockText.mockResolvedValue('# TDD\n\nContent here');
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns a Practice object with id, title, and content', async () => {
    // Arrange
    mockText.mockResolvedValue('# Implement TDD\n\nParsed content');

    // Act
    const result = await loadPracticeFromFilesystem('implement-tdd');

    // Assert
    expect(result).not.toBeNull();
    expect(result!.id).toBe('implement-tdd');
    expect(result!.title).toBe('Implement TDD');
    expect(result!.content).toContain('Parsed content');
  });

  it('reads the markdown file for the given practice ID', async () => {
    // Act
    await loadPracticeFromFilesystem('conduct-code-reviews');

    // Assert
    expect(Bun.file).toHaveBeenCalledWith('resources/practices/conduct-code-reviews.md');
  });

  it('extracts title from the H1 heading in markdown', async () => {
    // Arrange
    mockText.mockResolvedValue('# My Practice\n\nBody text');

    // Act
    const result = await loadPracticeFromFilesystem('my-practice');

    // Assert
    expect(result!.title).toBe('My Practice');
  });

  it('uses practice ID as fallback title when no H1 heading exists', async () => {
    // Arrange
    mockText.mockResolvedValue('No heading here, just text.');

    // Act
    const result = await loadPracticeFromFilesystem('my-practice');

    // Assert
    expect(result!.title).toBe('my-practice');
  });

  it('transforms capability links in the content', async () => {
    // Arrange
    mockText.mockResolvedValue('# Test\n\nSee [CI](/capabilities/ci.md).');

    // Act
    const result = await loadPracticeFromFilesystem('test');

    // Assert
    expect(result!.content).toContain('href="/catalog/capability/ci/"');
  });

  it('transforms practice links in the content', async () => {
    // Arrange
    mockText.mockResolvedValue('# Test\n\nSee [TDD](/practices/tdd.md).');

    // Act
    const result = await loadPracticeFromFilesystem('test');

    // Assert
    expect(result!.content).toContain('href="/catalog/practice/tdd/"');
  });

  it('returns null when file does not exist', async () => {
    // Arrange
    mockText.mockRejectedValue(new Error('File not found'));

    // Act
    const result = await loadPracticeFromFilesystem('nonexistent');

    // Assert
    expect(result).toBeNull();
  });
});
