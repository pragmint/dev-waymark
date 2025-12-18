import { getCapabilitiesByCategory, type Capability } from "./capabilities";

function getTrendIcon(trend: string): string {
  switch (trend) {
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "stable":
      return "→";
    default:
      return "→";
  }
}

function renderCapabilityTile(capability: Capability): string {
  const trendIcon = getTrendIcon(capability.trend);
  return `
    <div class="capability-tile" data-capability-id="${capability.id}">
      <div class="capability-tile-header">
        <h3 class="capability-tile-name">${capability.name}</h3>
        <span class="capability-tile-trend ${capability.trend}">${trendIcon}</span>
      </div>
      <div class="capability-tile-score">
        <span class="capability-tile-score-current">${capability.currentScore}</span>
        <span class="capability-tile-score-max">/ 4</span>
      </div>
      <div class="capability-tile-teams">
        <span class="capability-tile-teams-count">${capability.teamsTargeting}</span> team${capability.teamsTargeting !== 1 ? 's' : ''} targeting
      </div>
    </div>
  `;
}

export function generateCapabilityCatalogPageContent(): string {
  const capabilitiesByCategory = getCapabilitiesByCategory();

  const categorySections = Object.entries(capabilitiesByCategory)
    .map(([category, capabilities]) => {
      const tiles = capabilities.map(renderCapabilityTile).join("");
      return `
        <div class="capability-category-section">
          <h2 class="capability-category-title">${category}</h2>
          <div class="capability-tiles-grid">
            ${tiles}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <link rel="stylesheet" href="/resources/public/overview.css">

    <div class="capability-tiles-container">
      ${categorySections}
    </div>

    <script src="/resources/public/overview.js"></script>
  `;
}
