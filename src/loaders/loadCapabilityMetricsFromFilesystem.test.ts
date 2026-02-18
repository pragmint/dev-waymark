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

const { loadCapabilityMetricsFromFilesystem } =
  await import('./loadCapabilityMetricsFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

const VALID_METRIC_YAML = 'data:\n  - date: "1.1.2026"\n    value: 3\n    team: "team-a"';
const EMPTY_METRIC_YAML = 'data: []';

describe('loadCapabilityMetricsFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockText.mockReset();
    mockText.mockResolvedValue(VALID_METRIC_YAML);
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads and parses .yaml metric files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['ci.yaml', 'testing.yaml']);
    mockText.mockResolvedValueOnce(VALID_METRIC_YAML).mockResolvedValueOnce(EMPTY_METRIC_YAML);

    // Act
    const result = await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0].capabilityId).toBe('ci');
    expect(result[0].data).toHaveLength(1);
    expect(result[0].data[0].date).toBe('1.1.2026');
    expect(result[1].capabilityId).toBe('testing');
    expect(result[1].data).toEqual([]);
  });

  it('derives capabilityId from filename by stripping .yaml extension', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['code-maintainability.yaml']);

    // Act
    const result = await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(result[0].capabilityId).toBe('code-maintainability');
  });

  it('filters out non-.yaml files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['ci.yaml', 'readme.md', '.DS_Store']);

    // Act
    const result = await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadCapabilityMetricsFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('propagates parser validation errors for invalid YAML', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['bad.yaml']);
    mockText.mockResolvedValue('data:\n  - bad: true');

    // Act & Assert
    expect(loadCapabilityMetricsFromFilesystem()).rejects.toThrow();
  });

  it('reads from the correct directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadCapabilityMetricsFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('examples/metrics/capability_scores');
  });
});
