import { readdir } from 'node:fs/promises';
import type { Capability } from '../../core/data/capabilityTypes';

/**
 * Converts a kebab-case filename to Title Case
 * Example: "code-maintainability" -> "Code Maintainability"
 * Special rules:
 * - "ai" becomes "AI" (anywhere in the title)
 * - Articles and prepositions (the, and, to, of, in) stay lowercase (except at position 0)
 */
function filenameToTitle(filename: string): string {
  const lowercaseWords = new Set(['the', 'and', 'to', 'of', 'in']);

  return filename
    .split('-')
    .map((word, index) => {
      // Special case for "ai" - always uppercase
      if (word === 'ai') {
        return 'AI';
      }

      // First word is always capitalized (even if it's an article/preposition)
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      // Lowercase words stay lowercase
      if (lowercaseWords.has(word)) {
        return word;
      }

      // Regular title case
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

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
