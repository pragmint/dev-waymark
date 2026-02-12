import { marked } from 'marked';

export interface Practice {
  id: string;
  title: string;
  content: string;
}

// Pure function - reads markdown file from filesystem
async function readMarkdownFile(
  practiceId: string
): Promise<string> {
  const filename = `${practiceId}.md`;
  const filePath = `resources/private/markdown/practices/${filename}`;
  return await Bun.file(filePath).text();
}

// Pure function - parses markdown to HTML
async function parseMarkdown(markdown: string): Promise<string> {
  return await marked.parse(markdown);
}

// Pure function - extracts title from markdown
function extractTitle(markdown: string, fallbackId: string): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1] : fallbackId;
}

// Pure function - transforms capability links from markdown format to web format
function transformCapabilityLinks(html: string): string {
  return html.replace(/href="\/capabilities\/([a-z0-9-]+)\.md"/g, 'href="/catalog/capability/$1/"');
}

// Pure function - transforms practice links from markdown format to web format
function transformPracticeLinks(html: string): string {
  return html.replace(/href="\/practices\/([a-z0-9-]+)\.md"/g, 'href="/catalog/practice/$1/"');
}

// Pure function - transforms resource links to GitHub URLs
function transformResourceLinks(html: string): string {
  return html.replace(
    /href="\/resources\/(.+?)\.md"/g,
    'href="https://github.com/pragmint/open-practices/blob/main/resources/$1.md"'
  );
}

// Composed function - loads and parses a single practice
export async function loadPracticeFromFilesystem(
  practiceId: string,
): Promise<Practice | null> {
  try {
    // Load markdown
    const markdown = await readMarkdownFile(practiceId);

    // Parse markdown to HTML
    const rawHtml = await parseMarkdown(markdown);

    // Transform links
    let html = transformCapabilityLinks(rawHtml);
    html = transformPracticeLinks(html);
    html = transformResourceLinks(html);

    // Extract metadata
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

// Pure I/O function - loads all practices from filesystem
export async function loadAllPracticesFromFilesystem(): Promise<Practice[]> {
  const dir = 'resources/private/markdown/practices';
  const glob = new Bun.Glob('*.md');
  const files: string[] = Array.from(glob.scanSync(dir)) as string[];

  const practices = await Promise.all(
    files
      .filter(file => file.endsWith('.md'))
      .map(async file => {
        const practiceId = file.replace('.md', '');
        return await loadPracticeFromFilesystem(practiceId);
      })
  );

  // Filter out nulls and sort alphabetically
  return practices
    .filter((p): p is Practice => p !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Export individual functions for testing/reuse
export {
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
  parseMarkdown,
};
