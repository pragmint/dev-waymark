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

const { loadCapabilityMarkdown } = await import('./loadCapabilityMarkdown');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

describe('loadCapabilityMarkdown', () => {
  beforeEach(() => {
    mockText.mockReset();
    mockText.mockResolvedValue('# Test Capability\n\nSome content here.');
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('reads the markdown file for the given capability ID', async () => {
    // Act
    await loadCapabilityMarkdown('continuous-integration');

    // Assert
    expect(Bun.file).toHaveBeenCalledWith('resources/capabilities/continuous-integration.md');
  });

  it('parses markdown content to HTML', async () => {
    // Arrange
    mockText.mockResolvedValue('# CI\n\nSome content');

    // Act
    const result = await loadCapabilityMarkdown('ci');

    // Assert
    expect(result).toContain('<h1');
    expect(result).toContain('CI');
    expect(result).toContain('Some content');
  });

  it('transforms capability links in the HTML output', async () => {
    // Arrange — markdown with a capability link matching the transform pattern
    mockText.mockResolvedValue('See [CI](/capabilities/ci.md) for details.');

    // Act
    const result = await loadCapabilityMarkdown('test');

    // Assert — link should be transformed from .md to catalog route
    expect(result).toContain('href="/catalog/capability/ci/"');
    expect(result).not.toContain('href="/capabilities/ci.md"');
  });

  it('transforms practice links in the HTML output', async () => {
    // Arrange — markdown with a practice link matching the transform pattern
    mockText.mockResolvedValue('Try [TDD](/practices/tdd.md) practice.');

    // Act
    const result = await loadCapabilityMarkdown('test');

    // Assert — link should be transformed from .md to catalog route
    expect(result).toContain('href="/catalog/practice/tdd/"');
    expect(result).not.toContain('href="/practices/tdd.md"');
  });

  it('returns null when file does not exist', async () => {
    // Arrange
    mockText.mockRejectedValue(new Error('File not found'));

    // Act
    const result = await loadCapabilityMarkdown('nonexistent');

    // Assert
    expect(result).toBeNull();
  });

  it('returns non-null HTML for valid markdown', async () => {
    // Arrange
    mockText.mockResolvedValue('Hello world');

    // Act
    const result = await loadCapabilityMarkdown('test');

    // Assert
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });
});
