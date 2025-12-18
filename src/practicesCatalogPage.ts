import { marked } from "marked";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

interface Practice {
  filename: string;
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

async function loadPractice(filename: string): Promise<Practice> {
  const filePath = join("resources/private/markdown/practices", filename);
  const markdown = await Bun.file(filePath).text();

  // Parse markdown to HTML
  let html = await marked.parse(markdown);

  // Transform capability links
  html = transformCapabilityLinks(html);

  // Extract title from first h1
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : filename.replace(".md", "");

  return {
    filename,
    title,
    content: html,
  };
}

export async function generatePracticesCatalogPageContent(): Promise<string> {
  const dir = "resources/private/markdown/practices";
  const files = await readdir(dir);

  const practices = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => loadPractice(file))
  );

  const practiceLinks = practices
    .map((practice) => {
      const practiceId = practice.filename.replace(".md", "");
      return `
        <li class="practice-list-item">
          <a href="/catalog/practice/${practiceId}/">${practice.title}</a>
        </li>
      `;
    })
    .join("");

  return `
    <link rel="stylesheet" href="/resources/public/practices.css">

    <div class="practices-container">
      <div class="practices-intro">
        <p>
          Engineering practices are proven techniques and methodologies that help teams
          deliver better software. The practices below support the development of DORA
          capabilities and contribute to improved software delivery performance.
        </p>
      </div>

      <ul class="practices-list">
        ${practiceLinks}
      </ul>
    </div>
  `;
}
