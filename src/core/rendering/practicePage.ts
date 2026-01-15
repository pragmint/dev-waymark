import type { Practice } from "../../shell/loaders/practiceLoader";

// Pure rendering function for practice catalog page
export function generatePracticesCatalogPageContent(practices: Practice[]): string {
  const practiceLinks = practices
    .map((practice) => {
      return `
        <li class="practice-list-item">
          <a href="/catalog/practice/${practice.id}/">${practice.title}</a>
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

// Pure rendering function for practice detail page
export function generatePracticeDetailPageContent(practice: Practice): string {
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
