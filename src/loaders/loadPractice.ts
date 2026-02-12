import { Practice, parseMarkdown, transformCapabilityLinks, transformPracticeLinks, transformResourceLinks, extractTitle } from "../shell/loaders/practiceLoader";

async function readMarkdownFile(
  practiceId: string
): Promise<string> {
  const filename = `${practiceId}.md`;
  const filePath = `resources/private/markdown/practices/${filename}`;
  return await Bun.file(filePath).text();
}

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
