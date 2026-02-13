import {
  parseMarkdown,
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
} from '../../parsers/markdown';

export interface Practice {
  id: string;
  title: string;
  content: string;
}

// Pure function - reads markdown file from filesystem
async function readMarkdownFile(practiceId: string): Promise<string> {
  const filename = `${practiceId}.md`;
  const filePath = `resources/practices/${filename}`;
  return await Bun.file(filePath).text();
}

// Composed function - loads and parses a single practice
export async function loadPracticeFromFilesystem(practiceId: string): Promise<Practice | null> {
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
  const dir = 'resources/practices';
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

// Re-export parsing functions for downstream consumers
export {
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
  parseMarkdown,
};
