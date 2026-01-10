import { getTeamById, type Team, type ActiveExperiment, type TeamCapability } from "./teams";
import { getCapabilityById, getAllCapabilitiesAlphabetically, getCapabilitiesByCategory } from "./capabilities";
import { loadPracticeById } from "./practiceDetailPage";

function getStatusBadge(status: string): string {
  const statusColors: Record<string, { bg: string; text: string }> = {
    "in-progress": { bg: "#e8f4f8", text: "#0066cc" },
    "blocked": { bg: "#f8d7da", text: "#721c24" },
    "paused": { bg: "#fff3cd", text: "#856404" },
  };

  const colors = statusColors[status] || { bg: "#e0e0e0", text: "#666" };
  const label = status.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase());

  return `<span class="status-badge" style="background-color: ${colors.bg}; color: ${colors.text};">${label}</span>`;
}

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

function renderCapabilityTile(teamCapability: TeamCapability): string {
  const capability = getCapabilityById(teamCapability.id);
  if (!capability) {
    return `<div class="capability-tile error">Capability not found: ${teamCapability.id}</div>`;
  }

  const trendIcon = getTrendIcon(teamCapability.trend);
  return `
    <div class="capability-tile" data-capability-id="${capability.id}">
      <div class="capability-tile-header">
        <h3 class="capability-tile-name">${capability.name}</h3>
        <span class="capability-tile-trend ${teamCapability.trend}">${trendIcon}</span>
      </div>
      <div class="capability-tile-score">
        <span class="capability-tile-score-current">${teamCapability.currentScore}</span>
        <span class="capability-tile-score-max">/ 4</span>
      </div>
      <div class="capability-tile-category">
        ${capability.category}
      </div>
    </div>
  `;
}

async function renderTargetedCapabilities(teamCapabilities: TeamCapability[]): Promise<string> {
  if (!teamCapabilities || teamCapabilities.length === 0) {
    return '<p class="empty-state">No capabilities currently targeted.</p>';
  }

  const capabilityTiles = teamCapabilities.map(renderCapabilityTile).join("");

  return `<div id="targeted-capabilities" class="capability-tiles-grid">${capabilityTiles}</div>`;
}

async function renderExpandedCapabilities(team: Team): Promise<string> {
  const capabilitiesByCategory = getCapabilitiesByCategory();

  // Combine targeted and non-targeted capabilities into one map
  const allTeamCapabilities = [...team.targetedCapabilities, ...team.nonTargetedCapabilities];
  const teamCapabilityMap = new Map(allTeamCapabilities.map(tc => [tc.id, tc]));

  const categorySections = Object.entries(capabilitiesByCategory)
    .map(([category, capabilities]) => {
      const tiles = capabilities.map(capability => {
        const teamCapability = teamCapabilityMap.get(capability.id);
        if (teamCapability) {
          // Use team's specific score (both targeted and non-targeted)
          return renderCapabilityTile(teamCapability);
        } else {
          // This shouldn't happen if YAML is complete, but fallback to 0
          return renderCapabilityTile({
            id: capability.id,
            currentScore: 0,
            trend: "stable"
          });
        }
      }).join("");

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

  return `<div id="expanded-capabilities" class="expanded-capabilities">${categorySections}</div>`;
}

async function renderActiveExperiments(experiments: ActiveExperiment[]): Promise<string> {
  if (!experiments || experiments.length === 0) {
    return '<p class="empty-state">No active experiments at this time.</p>';
  }

  const experimentCards = await Promise.all(
    experiments.map(async (exp) => {
      const practice = await loadPracticeById(exp.practiceId);
      const practiceName = practice ? practice.title : exp.practiceId;

      return `
        <a href="/experiment/${exp.id}/" class="experiment-card-link">
          <div class="experiment-card">
            <div class="experiment-header">
              <h3>${practiceName}</h3>
              ${getStatusBadge(exp.status)}
            </div>
            <div class="experiment-meta">
              <span class="experiment-date">Started: ${new Date(exp.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              ${exp.duration ? `<span class="experiment-duration">${exp.duration}</span>` : ''}
            </div>
            <div class="experiment-hypothesis">
              <strong>Hypothesis:</strong>
              <p>${exp.hypothesis}</p>
            </div>
            <div class="experiment-view-details">
              View Details →
            </div>
          </div>
        </a>
      `;
    })
  );

  return `<div class="experiment-cards">${experimentCards.join("")}</div>`;
}

export async function generateTeamDetailPageContent(teamId: string): Promise<string | null> {
  const team = getTeamById(teamId);

  if (!team) {
    return null;
  }

  const targetedCapabilitiesHtml = await renderTargetedCapabilities(team.targetedCapabilities);
  const expandedCapabilitiesHtml = await renderExpandedCapabilities(team);
  const activeExperimentsHtml = await renderActiveExperiments(team.activeExperiments);

  return `
    <link rel="stylesheet" href="/resources/public/team-detail.css">
    <link rel="stylesheet" href="/resources/public/overview.css">

    <div class="team-detail-container">
      ${team.description ? `
        <div class="team-description">
          <p>${team.description}</p>
        </div>
      ` : ''}

      <section class="team-section">
        <h2>Capabilities</h2>
        <p class="section-intro">
          The capabilities this team is working on, showing team-specific scores and trends.
        </p>
        <div class="capability-tiles-container">
          ${targetedCapabilitiesHtml}
          ${expandedCapabilitiesHtml}
          <a class="toggle-view-link" id="toggle-view" href="#">
            View All Capabilities
          </a>
        </div>
      </section>

      <section class="team-section">
        <h2>Active Experiments</h2>
        <p class="section-intro">
          Engineering practices the team is experimenting with to improve their delivery performance.
        </p>
        ${activeExperimentsHtml}
      </section>

      <div class="team-actions">
        <a href="/" class="btn btn-secondary">← Back to Overview</a>
        <a href="/catalog/capability/" class="btn btn-primary">View All Capabilities</a>
      </div>
    </div>

    <script src="/resources/public/team-detail.js"></script>
  `;
}
