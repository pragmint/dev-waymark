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

const { loadTeamsFromFilesystem } = await import('./loadTeamsFromFilesystem');

afterAll(() => {
  mock.module('node:fs/promises', () => realFs);
  Bun.file = savedBunFile;
});

const TEAM_A_YAML = 'id: team-a\nname: Alpha';
const TEAM_B_YAML = 'id: team-b\nname: Beta';

describe('loadTeamsFromFilesystem', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReaddir.mockResolvedValue([]);
    mockText.mockReset();
    mockText.mockResolvedValue(TEAM_A_YAML);
    spyOn(console, 'log').mockImplementation(() => {});
  });

  it('loads and parses .yaml files from the teams directory', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['team-a.yaml', 'team-b.yaml']);
    mockText.mockResolvedValueOnce(TEAM_A_YAML).mockResolvedValueOnce(TEAM_B_YAML);

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('team-a');
    expect(result[1].id).toBe('team-b');
  });

  it('sorts teams alphabetically by name', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['z-team.yaml', 'a-team.yaml']);
    mockText
      .mockResolvedValueOnce('id: z-team\nname: Zebra')
      .mockResolvedValueOnce('id: a-team\nname: Alpha');

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result[0].name).toBe('Alpha');
    expect(result[1].name).toBe('Zebra');
  });

  it('filters out non-.yaml files', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['team-a.yaml', 'readme.md', '.gitkeep']);

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result).toHaveLength(1);
  });

  it('returns empty array when directory is empty', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // Arrange
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT errors', async () => {
    // Arrange
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReaddir.mockRejectedValue(error);

    // Act & Assert
    expect(loadTeamsFromFilesystem()).rejects.toThrow('EACCES');
  });

  it('propagates parser validation errors for invalid YAML', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['bad.yaml']);
    mockText.mockResolvedValue('bad: true');

    // Act & Assert
    expect(loadTeamsFromFilesystem()).rejects.toThrow();
  });

  it('reads files from the correct directory path', async () => {
    // Arrange
    mockReaddir.mockResolvedValue([]);

    // Act
    await loadTeamsFromFilesystem();

    // Assert
    expect(mockReaddir).toHaveBeenCalledWith('examples/teams');
  });

  it('populates default arrays for optional team fields', async () => {
    // Arrange
    mockReaddir.mockResolvedValue(['minimal.yaml']);
    mockText.mockResolvedValue('id: minimal\nname: Minimal');

    // Act
    const result = await loadTeamsFromFilesystem();

    // Assert
    expect(result[0].targetedCapabilities).toEqual([]);
    expect(result[0].nonTargetedCapabilities).toEqual([]);
    expect(result[0].activeExperiments).toEqual([]);
  });
});
