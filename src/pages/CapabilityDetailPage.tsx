import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';
import { getTrendIcon, getTrendLabel, getMaturityLevelLabel } from '../core/rendering/htmlHelpers';

interface CapabilityDetailPageProps {
  teams: Team[];
  capability: Capability;
}

export const CapabilityDetailPage: FC<CapabilityDetailPageProps> = ({ teams, capability }) => {
  const trendIcon = getTrendIcon(capability.trend);
  const trendLabel = getTrendLabel(capability.trend);

  return (
    <Page title={capability.name} heading={capability.name} activePage="capabilities" teams={teams}>
      <div class="capability-detail-container">
        <div class="capability-header">
          <div class="capability-header-main">
            <div class="capability-category-badge">{capability.category}</div>
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
                  <span class={`level ${capability.currentScore >= 1 ? 'achieved' : ''}`}>1</span>
                  <span class={`level ${capability.currentScore >= 2 ? 'achieved' : ''}`}>2</span>
                  <span class={`level ${capability.currentScore >= 3 ? 'achieved' : ''}`}>3</span>
                  <span class={`level ${capability.currentScore >= 4 ? 'achieved' : ''}`}>4</span>
                </div>
              </div>
            </div>
            <p>
              The organization is currently at level {capability.currentScore}, demonstrating{' '}
              {getMaturityLevelLabel(capability.currentScore).toLowerCase()} implementation of this
              capability.
            </p>
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
