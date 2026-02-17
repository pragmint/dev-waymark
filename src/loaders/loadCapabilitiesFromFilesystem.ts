import { readdir } from 'node:fs/promises';
import type { Capability } from '../core/data/capabilityTypes';

function filenameToTitle(filename: string): string {
  const lowercaseWords = new Set(['a', 'the', 'and', 'to', 'of', 'in']);

  return filename
    .split('-')
    .map((word, index) => {
      if (word === 'ai') return 'AI';
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      if (lowercaseWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Loads capabilities from markdown files
 * Directory structure: resources/capabilities/{capability-name}.md
 */
export async function loadCapabilitiesFromFilesystem(): Promise<Capability[]> {
  const dir = 'resources/capabilities';

  try {
    const files = await readdir(dir);

    const capabilities = files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const capabilityId = file.replace('.md', '');
        const name = filenameToTitle(capabilityId);

        return {
          id: capabilityId,
          name,
          currentScore: 0,
          trend: 'stable' as const,
          teamsTargeting: 0,
        };
      });

    console.log(`Loaded ${capabilities.length} capabilities`);

    return capabilities;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Capabilities directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
