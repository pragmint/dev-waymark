import { readFile } from 'node:fs/promises';
import type { MaturityLevel } from '../../core/domain/capabilitySchemas';

/**
 * Pure I/O function - parses the capabilities maturity assessment markdown file
 * Returns a map of capability ID to maturity levels
 */
export async function parseAssessmentMarkdown(): Promise<Map<string, MaturityLevel[]>> {
  const markdownPath = 'resources/capabilities-maturity-assessment.md';
  const content = await readFile(markdownPath, 'utf-8');

  const capabilityMap = new Map<string, MaturityLevel[]>();

  // Split markdown by H3 headers (capability sections)
  const capabilitySectionRegex = /^### \[(.+?)\]\(\/capabilities\/(.+?)\.md\)/gm;
  const sections: Array<{ name: string; id: string; content: string; startIndex: number }> = [];

  let match;
  while ((match = capabilitySectionRegex.exec(content)) !== null) {
    sections.push({
      name: match[1],
      id: match[2],
      content: '',
      startIndex: match.index,
    });
  }

  // Extract content for each section
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextSection = sections[i + 1];
    const endIndex = nextSection ? nextSection.startIndex : content.length;
    section.content = content.substring(section.startIndex, endIndex);
  }

  // Parse each capability section
  for (const section of sections) {
    try {
      const maturityLevels = parseCapabilitySection(section.content, section.id);
      if (maturityLevels.length > 0) {
        capabilityMap.set(section.id, maturityLevels);
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse capability "${section.id}":`, error);
    }
  }

  console.log(`Parsed maturity levels for ${capabilityMap.size} capabilities`);
  return capabilityMap;
}

/**
 * Parse a single capability section to extract maturity levels
 */
function parseCapabilitySection(sectionContent: string, _capabilityId: string): MaturityLevel[] {
  const maturityLevels: MaturityLevel[] = [];

  // Check if this capability has sub-dimensions (H4 headers)
  const dimensionHeaderRegex = /^#### (.+)/gm;
  const dimensionMatches = Array.from(sectionContent.matchAll(dimensionHeaderRegex));

  if (dimensionMatches.length > 0) {
    // Multi-dimension capability - parse each dimension separately
    for (let i = 0; i < dimensionMatches.length; i++) {
      const dimensionMatch = dimensionMatches[i];
      const dimensionName = dimensionMatch[1].trim();
      const dimensionStartIndex = dimensionMatch.index!;
      const dimensionEndIndex = dimensionMatches[i + 1]?.index ?? sectionContent.length;
      const dimensionContent = sectionContent.substring(dimensionStartIndex, dimensionEndIndex);

      const dimensionLevels = parseMaturityLevels(dimensionContent, dimensionName);
      maturityLevels.push(...dimensionLevels);
    }
  } else {
    // Simple capability - parse maturity levels directly
    const levels = parseMaturityLevels(sectionContent);
    maturityLevels.push(...levels);
  }

  return maturityLevels;
}

/**
 * Parse numbered maturity levels from content
 */
function parseMaturityLevels(content: string, dimension?: string): MaturityLevel[] {
  const maturityLevels: MaturityLevel[] = [];

  // Match numbered items: 1. **Title:** Description
  const levelRegex = /^(\d)\.\s+\*\*(.+?):\*\*\s+(.+?)(?=\n\d\.\s+\*\*|\n####|\n###|$)/gms;
  const matches = Array.from(content.matchAll(levelRegex));

  for (const match of matches) {
    const level = parseInt(match[1], 10);
    const title = match[2].trim();
    const description = match[3].trim();

    maturityLevels.push({
      level,
      title,
      description,
      dimension,
    });
  }

  return maturityLevels;
}
