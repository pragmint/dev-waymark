import { marked } from "marked";
import { join } from "node:path";

export interface Practice {
  id: string;
  title: string;
  content: string;
}

// Transform capability links from markdown format to web format
function transformCapabilityLinks(html: string): string {
  return html.replace(
    /href="\/capabilities\/([a-z0-9-]+)\.md"/g,
    'href="/catalog/capability/$1/"'
  );
}

// Pure I/O function - loads practice from filesystem
export async function loadPracticeFromFilesystem(practiceId: string): Promise<Practice | null> {
  const filename = `${practiceId}.md`;
  const filePath = join("resources/private/markdown/practices", filename);

  try {
    const markdown = await Bun.file(filePath).text();

    // Parse markdown to HTML
    let html = await marked.parse(markdown);

    // Transform capability links
    html = transformCapabilityLinks(html);

    // Extract title from first h1
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : practiceId;

    return {
      id: practiceId,
      title,
      content: html,
    };
  } catch (error) {
    return null;
  }
}
