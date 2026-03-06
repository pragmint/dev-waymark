import { join } from 'node:path';

/**
 * Gets the user data directory from environment variable or falls back to default
 * @returns Absolute path to user data directory
 */
export function getUserDataDir(): string {
  const envPath = process.env.STEP_ENGINE_USER_DATA;
  if (envPath) {
    console.log(`Using user data directory from STEP_ENGINE_USER_DATA: ${envPath}`);
    return envPath;
  }
  return 'examples';
}

/**
 * Helper to construct paths within the user data directory
 * @param paths - Path segments to join
 * @returns Full path within user data directory
 */
export function getUserDataPath(...paths: string[]): string {
  return join(getUserDataDir(), ...paths);
}
