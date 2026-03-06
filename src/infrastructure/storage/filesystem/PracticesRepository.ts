import { readdir } from 'node:fs/promises';
import {
  parseMarkdown,
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
} from '../../../parsers/markdown';
import type { Practice, PracticesRepository } from '../../../application/practices/Repository';

const PRACTICES_DIR = 'resources/practices';

export class FilesystemPracticesRepository implements PracticesRepository {
  async listAll(): Promise<Practice[]> {
    try {
      const files = await readdir(PRACTICES_DIR);

      const practices = await Promise.all(
        files
          .filter(file => file.endsWith('.md'))
          .map(async file => {
            const practiceId = file.replace('.md', '');
            return this.getById(practiceId);
          })
      );

      const result = practices
        .filter((p): p is Practice => p !== null)
        .sort((a, b) => a.title.localeCompare(b.title));

      console.log(`Loaded ${result.length} practices`);
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        console.log('Practices directory not found, returning empty array');
        return [];
      }
      throw error;
    }
  }

  async getById(id: string): Promise<Practice | null> {
    try {
      const filePath = `${PRACTICES_DIR}/${id}.md`;
      const markdown = await Bun.file(filePath).text();

      const rawHtml = await parseMarkdown(markdown);
      let html = transformCapabilityLinks(rawHtml);
      html = transformPracticeLinks(html);
      html = transformResourceLinks(html);

      const title = extractTitle(markdown, id);

      return { id, title, content: html };
    } catch (error) {
      console.log(`Failed to load practice ${id}`, { error });
      return null;
    }
  }
}
