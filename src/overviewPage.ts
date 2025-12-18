import {
  type Capability,
  getTopThreeCapabilities,
  getAllCapabilitiesAlphabetically,
  getCapabilitiesByCategory,
} from "./capabilities";

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

export async function generateOverviewPageContent(): Promise<string> {
  const topThree = getTopThreeCapabilities();
  const capabilitiesByCategory = getCapabilitiesByCategory();

  // Load executive summary partial
  const executiveSummaryFile = Bun.file(
    "resources/private/html/partials/overview/executive-summary.html"
  );
  const executiveSummary = await executiveSummaryFile.text();

  const topThreeTiles = topThree.map(renderCapabilityTile).join("");

  // Organize by category for expanded view
  const categorySections = Object.entries(capabilitiesByCategory)
    .map(([category, capabilities]) => {
      const tiles = capabilities.map(renderCapabilityTile).join("");
      return `
        <div class="capability-category-section">
          <h3 class="capability-category-title">${category}</h3>
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
      <div id="top-capabilities" class="capability-tiles-grid">
        ${topThreeTiles}
      </div>

      <div id="expanded-capabilities" class="expanded-capabilities">
        ${categorySections}
      </div>

      <a class="toggle-view-link" id="toggle-view" href="#">
        View All Capabilities
      </a>
    </div>

    ${executiveSummary}

    <script src="/resources/public/overview.js"></script>
  `;
}
