import { createInterface } from 'node:readline/promises';

/** Connection target for logging/prompts, with credentials stripped. */
export function maskConnectionTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Blocks until the operator types "yes" to confirm a destructive TRUNCATE +
 * reseed. Refuses outright when no interactive terminal is attached — a
 * misconfigured seed setting must never silently wipe a real database in
 * CI/production. Set DEV_WAYMARK_SOURCE_DB_SEED_CONFIRM=1 to bypass for
 * intentional non-interactive automation.
 */
export async function confirmDestructiveSeed(description: string): Promise<void> {
  if (!process.stdin.isTTY) {
    if (process.env.DEV_WAYMARK_SOURCE_DB_SEED_CONFIRM === '1') return;
    throw new Error(
      `Refusing to TRUNCATE and reseed ${description} with no interactive terminal attached. ` +
        'Set DEV_WAYMARK_SOURCE_DB_SEED_CONFIRM=1 to bypass this check for automated/CI runs.'
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis will TRUNCATE and reseed ${description}. Type "yes" to continue: `
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    throw new Error('Seed confirmation declined — aborting.');
  }
}
