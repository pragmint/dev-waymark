import { readdir } from 'node:fs/promises';
import type { Capability } from '../../core/data/capabilityTypes';
import { filenameToTitle } from '../../core/utils/stringUtils';

/**
 * Pure I/O function - loads capabilities from markdown files
 * Discovers all capabilities from the markdown directory
 */
export async function loadCapabilitiesFromFilesystem(): Promise<Capability[]> {
  const markdownDir = 'resources/private/markdown/capabilities';

  const files = await readdir(markdownDir);

  const capabilities = files
    .filter(file => file.endsWith('.md'))
    .map(file => {
      // Extract capability ID from filename (remove .md extension)
      const capabilityId = file.replace('.md', '');

      // Convert filename to human-readable name
      const name = filenameToTitle(capabilityId);

      // Create capability object with defaults
      // Note: currentScore, trend, and teamsTargeting will be set
      // by aggregation logic based on metrics
      return {
        id: capabilityId,
        name,
        currentScore: 0,
        trend: 'stable' as const,
        teamsTargeting: 0,
      };
    });

  return capabilities;
}
