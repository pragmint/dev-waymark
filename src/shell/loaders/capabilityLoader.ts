import { readdir } from 'node:fs/promises';
import { marked } from 'marked';
import type { Capability } from '../../core/data/capabilityTypes';
import { filenameToTitle } from '../../core/utils/stringUtils';
import { parseAssessmentMarkdown } from './assessmentParser';
import { consoleLogger } from '../../core/logger';

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
 * Pure function - transforms capability links from markdown format to web format
 */
function transformCapabilityLinks(html: string): string {
  return html.replace(/href="\/capabilities\/([a-z0-9-]+)\.md"/g, 'href="/catalog/capability/$1/"');
}

/**
 * Pure function - transforms practice links from markdown format to web format
 */
function transformPracticeLinks(html: string): string {
  return html.replace(/href="\/practices\/([a-z0-9-]+)\.md"/g, 'href="/catalog/practice/$1/"');
}

/**
 * Loads and parses capability markdown content
 */
export async function loadCapabilityMarkdown(capabilityId: string): Promise<string | null> {
  try {
    const filename = `${capabilityId}.md`;
    const filePath = `resources/private/markdown/capabilities/${filename}`;

    // Load markdown
    const markdown = await Bun.file(filePath).text();

    // Parse markdown to HTML
    const rawHtml = await marked.parse(markdown);

    // Transform links
    let html = transformCapabilityLinks(rawHtml);
    html = transformPracticeLinks(html);

    return html;
  } catch (error) {
    consoleLogger.error(`Failed to load capability markdown ${capabilityId}`, { error });
    return null;
  }
}

