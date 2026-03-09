import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseCapabilityMarkdown,
  CapabilityParseError,
} from '../parsers/markdown/capabilityParser';
import type { Capability } from '../schemas/capabilitySchemas';

const CAPABILITIES_DIR = 'resources/capabilities';

async function parseCapabilityFile(file: string): Promise<Capability | null> {
  try {
    const filePath = join(CAPABILITIES_DIR, file);
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseCapabilityMarkdown(content);
    const id = file.replace(/\.md$/, '');
    return {
      id,
      name: parsed.title,
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
      description: parsed.introduction,
      maturityLevels: parsed.assessment.ratings.map(rating => ({
        level: rating.rating,
        title: rating.title,
        description: rating.description,
        dimension: rating.dimension,
      })),
    };
  } catch (error) {
    if (error instanceof CapabilityParseError) {
      console.warn(`Warning: Failed to parse capability file "${file}": ${error.message}`);
    } else {
      console.warn(`Warning: Failed to read capability file "${file}": ${error}`);
    }
    return null;
  }
}

export async function loadAndParseCapabilities(): Promise<Capability[]> {
  try {
    const files = await readdir(CAPABILITIES_DIR);
    const mdFiles = files.filter(file => file.endsWith('.md'));

    const capabilities: Capability[] = [];

    for (const file of mdFiles) {
      const capability = await parseCapabilityFile(file);
      if (capability) capabilities.push(capability);
    }

    // Sort by name
    capabilities.sort((a, b) => a.name.localeCompare(b.name));

    return capabilities;
  } catch (error) {
    // Directory doesn't exist or can't be read
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
