import { marked } from 'marked';

export async function parseMarkdown(markdown: string): Promise<string> {
  return await marked.parse(markdown);
}

export function extractTitle(markdown: string, fallbackId: string): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1] : fallbackId;
}

export function transformCapabilityLinks(html: string): string {
  return html.replace(/href="\/capabilities\/([a-z0-9-]+)\.md"/g, 'href="/catalog/capability/$1/"');
}

export function transformPracticeLinks(html: string): string {
  return html.replace(/href="\/practices\/([a-z0-9-]+)\.md"/g, 'href="/catalog/practice/$1/"');
}

export function transformResourceLinks(html: string): string {
  return html.replace(
    /href="\/resources\/(.+?)\.md"/g,
    'href="https://github.com/pragmint/open-practices/blob/main/resources/$1.md"'
  );
}
