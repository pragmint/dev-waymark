import {
  parseMarkdown,
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
} from '../parsers/markdown';

export interface Practice {
  id: string;
  title: string;
  content: string;
}

/**
 * Loads and parses a single practice by ID
 */
export async function loadPracticeFromFilesystem(practiceId: string): Promise<Practice | null> {
  try {
    const filePath = `resources/practices/${practiceId}.md`;
    const markdown = await Bun.file(filePath).text();

    const rawHtml = await parseMarkdown(markdown);

    let html = transformCapabilityLinks(rawHtml);
    html = transformPracticeLinks(html);
    html = transformResourceLinks(html);

    const title = extractTitle(markdown, practiceId);

    return {
      id: practiceId,
      title,
      content: html,
    };
  } catch (error) {
    console.log(`Failed to load practice ${practiceId}`, { error });
    return null;
  }
}
