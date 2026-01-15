import type { Team, TeamCapability, ActiveExperiment } from "../data/teamTypes";
import type { Capability } from "../data/capabilityTypes";
import type { Practice } from "../../shell/loaders/practiceLoader";
import { getTrendIcon, getStatusBadge } from "./htmlHelpers";

// Pure rendering function for team capability tile
function renderTeamCapabilityTile(
  teamCapability: TeamCapability,
  capability: Capability
): string {
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

// Pure rendering function for targeted capabilities section
function renderTargetedCapabilities(
  teamCapabilities: TeamCapability[],
  capabilityMap: Map<string, Capability>
): string {
  if (!teamCapabilities || teamCapabilities.length === 0) {
    return '<p class="empty-state">No capabilities currently targeted.</p>';
  }

  const capabilityTiles = teamCapabilities
    .map((tc) => {
      const capability = capabilityMap.get(tc.id);
      if (!capability) {
        return `<div class="capability-tile error">Capability not found: ${tc.id}</div>`;
      }
      return renderTeamCapabilityTile(tc, capability);
    })
    .join("");

  return `<div id="targeted-capabilities" class="capability-tiles-grid">${capabilityTiles}</div>`;
}

// Pure rendering function for expanded capabilities section
function renderExpandedCapabilities(
  team: Team,
  capabilitiesByCategory: Record<string, Capability[]>
): string {
  // Combine targeted and non-targeted capabilities into one map
  const allTeamCapabilities = [...team.targetedCapabilities, ...team.nonTargetedCapabilities];
  const teamCapabilityMap = new Map(allTeamCapabilities.map((tc) => [tc.id, tc]));

  const categorySections = Object.entries(capabilitiesByCategory)
    .map(([category, capabilities]) => {
      const tiles = capabilities
        .map((capability) => {
          const teamCapability = teamCapabilityMap.get(capability.id);
          if (teamCapability) {
            return renderTeamCapabilityTile(teamCapability, capability);
          } else {
            // Fallback to 0 score if team doesn't have this capability
            return renderTeamCapabilityTile(
              {
                id: capability.id,
                currentScore: 0,
                trend: "stable",
              },
              capability
            );
          }
        })
        .join("");

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

// Pure rendering function for experiment card
function renderExperimentCard(experiment: ActiveExperiment, practiceName: string): string {
  return `
    <a href="/experiment/${experiment.id}/" class="experiment-card-link">
      <div class="experiment-card">
        <div class="experiment-header">
          <h3>${practiceName}</h3>
          ${getStatusBadge(experiment.status)}
        </div>
        <div class="experiment-meta">
          <span class="experiment-date">Started: ${new Date(experiment.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          ${experiment.duration ? `<span class="experiment-duration">${experiment.duration}</span>` : ''}
        </div>
        <div class="experiment-hypothesis">
          <strong>Hypothesis:</strong>
          <p>${experiment.hypothesis}</p>
        </div>
        <div class="experiment-view-details">
          View Details →
        </div>
      </div>
    </a>
  `;
}

// Pure rendering function for active experiments section
function renderActiveExperiments(
  experiments: ActiveExperiment[],
  practiceMap: Map<string, Practice>
): string {
  if (!experiments || experiments.length === 0) {
    return '<p class="empty-state">No active experiments at this time.</p>';
  }

  const experimentCards = experiments
    .map((exp) => {
      const practice = practiceMap.get(exp.practiceId);
      const practiceName = practice ? practice.title : exp.practiceId;
      return renderExperimentCard(exp, practiceName);
    })
    .join("");

  return `<div class="experiment-cards">${experimentCards}</div>`;
}

// Pure rendering function for team detail page
export function generateTeamDetailPageContent(
  team: Team,
  capabilitiesByCategory: Record<string, Capability[]>,
  capabilityMap: Map<string, Capability>,
  practiceMap: Map<string, Practice>
): string {
  const targetedCapabilitiesHtml = renderTargetedCapabilities(
    team.targetedCapabilities,
    capabilityMap
  );
  const expandedCapabilitiesHtml = renderExpandedCapabilities(team, capabilitiesByCategory);
  const activeExperimentsHtml = renderActiveExperiments(team.activeExperiments, practiceMap);

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
