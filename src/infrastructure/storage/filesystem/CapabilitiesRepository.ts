import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseCapabilityMarkdown,
  CapabilityParseError,
} from '../../../parsers/markdown/capabilityParser';
import {
  parseMarkdown,
  transformCapabilityLinks,
  transformPracticeLinks,
} from '../../../parsers/markdown';
import type { Capability } from '../../../schemas/capabilitySchemas';
import type { CapabilitiesRepository } from '../../../application/capabilities/Repository';

const CAPABILITIES_DIR = 'resources/capabilities';

export class FilesystemCapabilitiesRepository implements CapabilitiesRepository {
  async listAll(): Promise<Capability[]> {
    try {
      const files = await readdir(CAPABILITIES_DIR);
      const mdFiles = files.filter(file => file.endsWith('.md'));

      const capabilities: Capability[] = [];

      for (const file of mdFiles) {
        try {
          const filePath = join(CAPABILITIES_DIR, file);
          const content = await readFile(filePath, 'utf-8');
          const parsed = parseCapabilityMarkdown(content);
          const id = file.replace(/\.md$/, '');

          const capability: Capability = {
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

          capabilities.push(capability);
        } catch (error) {
          if (error instanceof CapabilityParseError) {
            console.warn(`Warning: Failed to parse capability file "${file}": ${error.message}`);
          } else {
            console.warn(`Warning: Failed to read capability file "${file}": ${error}`);
          }
        }
      }

      capabilities.sort((a, b) => a.name.localeCompare(b.name));
      return capabilities;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async getMarkdown(id: string): Promise<string | null> {
    try {
      const filePath = `${CAPABILITIES_DIR}/${id}.md`;
      const markdown = await Bun.file(filePath).text();

      const rawHtml = await parseMarkdown(markdown);
      let html = transformCapabilityLinks(rawHtml);
      html = transformPracticeLinks(html);

      return html;
    } catch (error) {
      console.log(`Failed to load capability markdown ${id}`, { error });
      return null;
    }
  }
}
