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
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';
import {
  parseMarkdown,
  transformCapabilityLinks,
  transformPracticeLinks,
} from '../parsers/markdown';

/**
 * Pure I/O function - loads capabilities from markdown files
 * Discovers all capabilities from the markdown directory
 */
export async function loadCapabilitiesFromFilesystem(): Promise<Capability[]> {
  const markdownDir = 'resources/capabilities';

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

/**
 * Enriches capabilities with maturity level descriptions from the assessment markdown
 */
export async function enrichCapabilitiesWithAssessment(
  capabilities: Capability[]
): Promise<Capability[]> {
  const assessmentData = await parseAssessmentMarkdown();

  return capabilities.map(capability => {
    const maturityLevels = assessmentData.get(capability.id);
    if (maturityLevels) {
      return {
        ...capability,
        maturityLevels,
      };
    }
    return capability;
  });
}

/**
 * Loads and parses capability markdown content
 */
export async function loadCapabilityMarkdown(capabilityId: string): Promise<string | null> {
  try {
    const filename = `${capabilityId}.md`;
    const filePath = `resources/capabilities/${filename}`;

    // Load markdown
    const markdown = await Bun.file(filePath).text();

    // Parse markdown to HTML
    const rawHtml = await parseMarkdown(markdown);

    // Transform links
    let html = transformCapabilityLinks(rawHtml);
    html = transformPracticeLinks(html);

    return html;
  } catch (error) {
    console.log(`Failed to load capability markdown ${capabilityId}`, { error });
    return null;
  }
}
