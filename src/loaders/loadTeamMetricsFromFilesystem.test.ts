import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

const mockReaddir = mock<(path: string) => Promise<string[]>>(() => Promise.resolve([]));
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

const { loadTeamMetricsFromFilesystem } = await import('./loadTeamMetricsFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

const VALID_TEAM_METRIC_YAML = 'data:\n  - date: "27.1.2026"\n    value: 42';

describe('loadTeamMetricsFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockText.mockReset();
    mockText.mockResolvedValue(VALID_TEAM_METRIC_YAML);
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads metrics from nested team directories', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['team_a']).mockResolvedValueOnce(['linter-errors.yaml']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe('team-a');
    expect(result[0].metricName).toBe('linter-errors');
    expect(result[0].data[0].value).toBe(42);
  });

  it('converts underscores in directory names to dashes for teamId', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['my_team_name']).mockResolvedValueOnce(['metric.yaml']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result[0].teamId).toBe('my-team-name');
  });

  it('derives metricName from filename by stripping .yaml extension', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a'])
      .mockResolvedValueOnce(['code-quality-score.yaml']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result[0].metricName).toBe('code-quality-score');
  });

  it('filters out non-.yaml files within team directories', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a'])
      .mockResolvedValueOnce(['metric.yaml', 'notes.txt', '.gitkeep']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('loads metrics from multiple team directories', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a', 'team_b'])
      .mockResolvedValueOnce(['metric-a.yaml'])
      .mockResolvedValueOnce(['metric-b.yaml', 'metric-c.yaml']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(3);
    expect(result[0].teamId).toBe('team-a');
    expect(result[1].teamId).toBe('team-b');
    expect(result[2].teamId).toBe('team-b');
  });

  it('continues to next team dir when inner readdir fails', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['broken_team', 'good_team'])
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(['metric.yaml']);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe('good-team');
  });

  it('returns empty array when top-level directory has no subdirectories', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadTeamMetricsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors from top-level readdir', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadTeamMetricsFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('reads from the correct top-level directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadTeamMetricsFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('examples/metrics/team_specific');
  });
});
