import { marked } from "marked";
import { join } from "node:path";

interface Practice {
  id: string;
  title: string;
  content: string;
}

// Transform capability links from markdown format to web format
function transformCapabilityLinks(html: string): string {
  // Transform /capabilities/capability-name.md to /catalog/capability/capability-name/
  return html.replace(
    /href="\/capabilities\/([a-z0-9-]+)\.md"/g,
    'href="/catalog/capability/$1/"'
  );
}

export async function loadPracticeById(practiceId: string): Promise<Practice | null> {
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

export async function generatePracticeDetailPageContent(practiceId: string): Promise<string | null> {
  const practice = await loadPracticeById(practiceId);

  if (!practice) {
    return null;
  }

  // Remove the first h1 heading since it's already in the page heading
  const contentWithoutH1 = practice.content.replace(/<h1[^>]*>.*?<\/h1>/i, '');

  return `
    <link rel="stylesheet" href="/resources/public/practices.css">

    <div class="practice-detail-container">
      <div class="practice-content markdown-content">
        ${contentWithoutH1}
      </div>

      <div class="practice-actions">
        <a href="/" class="btn btn-secondary">← Back to Overview</a>
        <a href="/catalog/practice/" class="btn btn-primary">View All Practices</a>
      </div>
    </div>
  `;
}
