import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../core/data/teamTypes';
import type { Capability, MaturityLevel } from '../core/data/capabilityTypes';
import { getTrendIcon, getTrendLabel, getMaturityLevelLabel } from '../core/rendering/htmlHelpers';

interface CapabilityDetailPageProps {
  teams: Team[];
  capability: Capability;
  selectedTeam: string;
}

/**
 * Group maturity levels by dimension
 */
function groupByDimension(
  maturityLevels: MaturityLevel[]
): Map<string | undefined, MaturityLevel[]> {
  const grouped = new Map<string | undefined, MaturityLevel[]>();

  for (const level of maturityLevels) {
    const dimension = level.dimension;
    if (!grouped.has(dimension)) {
      grouped.set(dimension, []);
    }
    grouped.get(dimension)!.push(level);
  }

  // Sort levels within each dimension
  for (const levels of grouped.values()) {
    levels.sort((a, b) => a.level - b.level);
  }

  return grouped;
}

/**
 * Render maturity level cards
 */
function renderMaturityLevels(capability: Capability) {
  if (!capability.maturityLevels || capability.maturityLevels.length === 0) {
    return null;
  }

  const grouped = groupByDimension(capability.maturityLevels);
  const hasMultipleDimensions =
    grouped.size > 1 || (grouped.size === 1 && grouped.keys().next().value !== undefined);

  return (
    <div class="maturity-display">
      {hasMultipleDimensions && (
        <div class="dimension-note">
          <strong>ℹ️ Note:</strong> This capability is assessed across multiple dimensions. Your
          current score of <strong>{capability.currentScore}</strong> is an average across all
          dimensions.
        </div>
      )}

      {Array.from(grouped.entries()).map(([dimension, levels]) => (
        <div class="maturity-dimensions">
          {dimension && <h3 class="dimension-header">{dimension}</h3>}
          <div class="maturity-grid">
            {levels.map(level => {
              // Only highlight if score is a whole number matching this level
              const isExactMatch = capability.currentScore === level.level;
              // Check if this level is part of an approaching state (decimal score)
              const isDecimalScore = capability.currentScore % 1 !== 0;
              const isApproaching =
                isDecimalScore &&
                capability.currentScore > level.level - 1 &&
                capability.currentScore <= level.level;

              return (
                <div
                  class={`maturity-card ${isExactMatch ? 'current' : ''} ${isApproaching ? 'approaching' : ''}`}
                >
                  <div class="maturity-card-header">
                    <span class="maturity-card-level">Level {level.level}</span>
                    {isExactMatch && <span class="current-badge">Current</span>}
                    {isApproaching && <span class="approaching-badge">Approaching</span>}
                  </div>
                  <h4 class="maturity-card-title">{level.title}</h4>
                  <p class="maturity-card-description">{level.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export const CapabilityDetailPage: FC<CapabilityDetailPageProps> = ({
  teams,
  capability,
  selectedTeam,
}) => {
  const trendIcon = getTrendIcon(capability.trend);
  const trendLabel = getTrendLabel(capability.trend);

  // Build team options for dropdown
  const teamOptions = [
    { value: 'all', label: 'Average' },
    ...teams.map(team => ({
      value: team.id,
      label: team.name,
    })),
  ];

  return (
    <Page title={capability.name} heading="" activePage="capabilities" teams={teams}>
      <div class="capability-detail-container">
        {/* Custom header with dropdown */}
        <div class="capability-page-header">
          <h1>{capability.name}</h1>
          <div class="capability-filter">
            <label for="team-filter" class="filter-label">
              View score for:
            </label>
            <select
              id="team-filter"
              class="team-filter-dropdown"
              onchange="window.location.href = window.location.pathname + (this.value === 'all' ? '' : '?team=' + this.value)"
            >
              {teamOptions.map(option => (
                <option value={option.value} selected={option.value === selectedTeam}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="capability-header">
          <div class="capability-header-main">
            <div class="capability-meta">
              <div class="capability-score-large">
                <span class="score-current">{capability.currentScore}</span>
                <span class="score-max">/ 4</span>
              </div>
              <div class={`capability-trend ${capability.trend}`}>
                <span class="trend-icon">{trendIcon}</span>
                <span class="trend-label">{trendLabel}</span>
              </div>
            </div>
          </div>
          <div class="capability-teams-info">
            <strong>{capability.teamsTargeting}</strong> team
            {capability.teamsTargeting !== 1 ? 's' : ''} currently targeting this capability
          </div>
        </div>

        <div class="capability-content">
          {capability.description && (
            <section class="capability-section">
              <h2>Overview</h2>
              <p>{capability.description}</p>
            </section>
          )}

          <section class="capability-section">
            <h2>Current State</h2>
            {capability.maturityLevels && capability.maturityLevels.length > 0 ? (
              renderMaturityLevels(capability)
            ) : (
              <div>
                <div class="maturity-level">
                  <div class="maturity-level-header">
                    <h3>Maturity Level: {capability.currentScore}</h3>
                    <span class="maturity-level-label">
                      {getMaturityLevelLabel(capability.currentScore)}
                    </span>
                  </div>
                  <div class="maturity-progress">
                    <div class="maturity-progress-bar">
                      <div
                        class="maturity-progress-fill"
                        style={`width: ${(capability.currentScore / 4) * 100}%`}
                      ></div>
                    </div>
                    <div class="maturity-levels">
                      <span class={`level ${capability.currentScore >= 1 ? 'achieved' : ''}`}>
                        1
                      </span>
                      <span class={`level ${capability.currentScore >= 2 ? 'achieved' : ''}`}>
                        2
                      </span>
                      <span class={`level ${capability.currentScore >= 3 ? 'achieved' : ''}`}>
                        3
                      </span>
                      <span class={`level ${capability.currentScore >= 4 ? 'achieved' : ''}`}>
                        4
                      </span>
                    </div>
                  </div>
                </div>
                <p>
                  The organization is currently at level {capability.currentScore}, demonstrating{' '}
                  {getMaturityLevelLabel(capability.currentScore).toLowerCase()} implementation of
                  this capability.
                </p>
              </div>
            )}
          </section>

          <section class="capability-section">
            <h2>Teams Working On This</h2>
            <p>
              {capability.teamsTargeting} team{capability.teamsTargeting !== 1 ? 's are' : ' is'}{' '}
              actively working to improve this capability. Teams targeting this capability are
              focused on implementing best practices and measuring their progress.
            </p>
            <div class="placeholder-note">
              <em>Team-specific details and progress will be displayed here.</em>
            </div>
          </section>

          <section class="capability-section">
            <h2>Key Practices</h2>
            <div class="placeholder-note">
              <em>
                Recommended practices and implementation guidance for this capability will be
                displayed here.
              </em>
            </div>
          </section>

          <section class="capability-section">
            <h2>Related Resources</h2>
            <div class="placeholder-note">
              <em>Links to documentation, tools, and learning resources will be displayed here.</em>
            </div>
          </section>

          <section class="capability-section">
            <h2>Success Stories</h2>
            <div class="placeholder-note">
              <em>
                Examples of successful implementations and lessons learned will be displayed here.
              </em>
            </div>
          </section>
        </div>

        <div class="capability-actions">
          <a href="/" class="btn btn-secondary">
            ← Back to Overview
          </a>
          <a href="/catalog/capability/" class="btn btn-primary">
            View All Capabilities
          </a>
        </div>
      </div>
    </Page>
  );
};
