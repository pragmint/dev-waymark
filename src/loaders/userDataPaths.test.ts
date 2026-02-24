import { describe, expect, test, beforeEach, afterAll, spyOn } from 'bun:test';
import { getUserDataDir, getUserDataPath } from './userDataPaths';

describe('getUserDataDir', () => {
  const originalEnv = process.env.STEP_ENGINE_USER_DATA;

  beforeEach(() => {
    // Restore original environment before each test
    if (originalEnv !== undefined) {
      process.env.STEP_ENGINE_USER_DATA = originalEnv;
    } else {
      delete process.env.STEP_ENGINE_USER_DATA;
    }
    // Suppress console.log output during tests
    spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    // Ensure env is restored after all tests
    if (originalEnv !== undefined) {
      process.env.STEP_ENGINE_USER_DATA = originalEnv;
    } else {
      delete process.env.STEP_ENGINE_USER_DATA;
    }
  });

  test('returns default "examples" when environment variable is not set', () => {
    delete process.env.STEP_ENGINE_USER_DATA;
    expect(getUserDataDir()).toBe('examples');
  });

  test('returns environment variable value when set', () => {
    process.env.STEP_ENGINE_USER_DATA = '/custom/data/path';
    expect(getUserDataDir()).toBe('/custom/data/path');
  });

  test('returns default when environment variable is explicitly empty', () => {
    process.env.STEP_ENGINE_USER_DATA = '';
    expect(getUserDataDir()).toBe('examples');
  });
});

describe('getUserDataPath', () => {
  const originalEnv = process.env.STEP_ENGINE_USER_DATA;

  beforeEach(() => {
    if (originalEnv !== undefined) {
      process.env.STEP_ENGINE_USER_DATA = originalEnv;
    } else {
      delete process.env.STEP_ENGINE_USER_DATA;
    }
    spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    // Ensure env is restored after all tests
    if (originalEnv !== undefined) {
      process.env.STEP_ENGINE_USER_DATA = originalEnv;
    } else {
      delete process.env.STEP_ENGINE_USER_DATA;
    }
  });

  test('constructs path with single segment using default dir', () => {
    delete process.env.STEP_ENGINE_USER_DATA;
    const result = getUserDataPath('teams');
    expect(result).toBe('examples/teams');
  });

  test('constructs path with multiple segments using default dir', () => {
    delete process.env.STEP_ENGINE_USER_DATA;
    const result = getUserDataPath('metrics', 'team_specific', 'team_a');
    expect(result).toBe('examples/metrics/team_specific/team_a');
  });

  test('constructs path with no segments returns base dir', () => {
    delete process.env.STEP_ENGINE_USER_DATA;
    const result = getUserDataPath();
    expect(result).toBe('examples');
  });

  test('constructs path using custom environment variable', () => {
    process.env.STEP_ENGINE_USER_DATA = '/custom/data';
    const result = getUserDataPath('teams', 'team-a.yaml');
    expect(result).toBe('/custom/data/teams/team-a.yaml');
  });

  test('handles path segments with slashes', () => {
    delete process.env.STEP_ENGINE_USER_DATA;
    const result = getUserDataPath('experiments/team_a', 'exp-1.yaml');
    expect(result).toBe('examples/experiments/team_a/exp-1.yaml');
  });
});
