import { describe, it, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';
import type { Stats } from 'node:fs';

// Save real modules before mocking
const realFs = await import('node:fs/promises');

const mockReaddir = mock<(path: string) => Promise<string[]>>(() => Promise.resolve([]));
const mockStat = mock<(path: string) => Promise<Stats>>(() =>
  Promise.resolve({ isDirectory: () => true } as Stats)
);
mock.module('node:fs/promises', () => ({
  ...realFs,
  readdir: mockReaddir,
  stat: mockStat,
}));

// Mock the userDataPaths module to return test paths
mock.module('./userDataPaths', () => ({
  getUserDataDir: () => process.env.STEP_ENGINE_USER_DATA || 'examples',
  getUserDataPath: (...paths: string[]) => {
    const baseDir = process.env.STEP_ENGINE_USER_DATA || 'examples';
    return [baseDir, ...paths].join('/');
  },
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

const { loadExperimentsFromFilesystem } = await import('./loadExperimentsFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

const VALID_EXPERIMENT_YAML = `context:
  problem_statement: "Problem"
  desired_outcome: "Outcome"
hypothesis:
  statement: "If X then Y"
intervention:
  practice_under_test: tdd
  description: "Do TDD"
  status: active`;

describe('loadExperimentsFromFilesystem', () => {
  beforeEach(() => {
    delete process.env.STEP_ENGINE_USER_DATA; // Ensure clean env for each test
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockStat.mockReset();
    mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
    mockText.mockReset();
    mockText.mockResolvedValue(VALID_EXPERIMENT_YAML);
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads experiments from nested team directories', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['team_a']).mockResolvedValueOnce(['enforce-types.yaml']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('enforce-types');
    expect(result[0].teamId).toBe('team-a');
    expect(result[0].context.problemStatement).toBe('Problem');
  });

  it('converts underscores in directory names to dashes for teamId', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['my_team_name']).mockResolvedValueOnce(['exp.yaml']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result[0].teamId).toBe('my-team-name');
  });

  it('derives experimentId from filename by stripping .yaml extension', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a'])
      .mockResolvedValueOnce(['enforce-types-with-a-linter.yaml']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result[0].id).toBe('enforce-types-with-a-linter');
  });

  it('generates title from experiment ID', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['team_a']).mockResolvedValueOnce(['enforce-types.yaml']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result[0].title).toBe('Enforce Types');
  });

  it('filters out non-.yaml files', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a'])
      .mockResolvedValueOnce(['exp.yaml', 'notes.md', '.DS_Store']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('skips entries that are not directories (stat check)', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['team_a', 'readme.md']).mockResolvedValueOnce(['exp.yaml']);
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true } as Stats)
      .mockResolvedValueOnce({ isDirectory: () => false } as Stats);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('continues to next entry when stat fails', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['broken_entry', 'team_a'])
      .mockResolvedValueOnce(['exp.yaml']);
    mockStat
      .mockRejectedValueOnce(new Error('stat failed'))
      .mockResolvedValueOnce({ isDirectory: () => true } as Stats);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('loads experiments from multiple team directories', async () => {
    // Arrange
    mockReaddir
      .mockResolvedValueOnce(['team_a', 'team_b'])
      .mockResolvedValueOnce(['exp-1.yaml'])
      .mockResolvedValueOnce(['exp-2.yaml', 'exp-3.yaml']);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toHaveLength(3);
  });

  it('returns empty array when top-level directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadExperimentsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors from top-level readdir', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadExperimentsFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('reads from the correct top-level directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadExperimentsFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('examples/experiments');
  });

  it('propagates parser validation errors for invalid YAML', async () => {
    // Arrange
    mockReaddir.mockResolvedValueOnce(['team_a']).mockResolvedValueOnce(['bad.yaml']);
    mockText.mockResolvedValue('bad: true');

    // Act & Assert
    expect(loadExperimentsFromFilesystem()).rejects.toThrow();
  });
});
