import {
  parseMarkdown,
  transformCapabilityLinks,
  transformPracticeLinks,
} from '../parsers/markdown';

/**
 * Loads and parses capability markdown content
 */
export async function loadCapabilityMarkdown(capabilityId: string): Promise<string | null> {
  try {
    const filePath = `resources/capabilities/${capabilityId}.md`;
    const markdown = await Bun.file(filePath).text();

    const rawHtml = await parseMarkdown(markdown);

    let html = transformCapabilityLinks(rawHtml);
    html = transformPracticeLinks(html);

    return html;
  } catch (error) {
    console.log(`Failed to load capability markdown ${capabilityId}`, { error });
    return null;
  }
}
