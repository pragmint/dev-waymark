import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { TeamCapabilityTile } from '../components/TeamCapabilityTile';
import type { Team, ActiveExperiment } from '../core/data/teamTypes';
import type { Capability } from '../core/data/capabilityTypes';
import type { Practice } from '../shell/loaders/practiceLoader';
import { getStatusBadge } from '../core/rendering/htmlHelpers';

interface TeamDetailPageProps {
  teams: Team[];
  team: Team;
  capabilitiesByCategory: Record<string, Capability[]>;
  capabilityMap: Map<string, Capability>;
  practiceMap: Map<string, Practice>;
}

const ExperimentCard: FC<{ experiment: ActiveExperiment; practiceName: string }> = ({
  experiment,
  practiceName,
}) => {
  return (
    <a href={`/experiment/${experiment.id}/`} class="experiment-card-link">
      <div class="experiment-card">
        <div class="experiment-header">
          <h3>{practiceName}</h3>
          <span dangerouslySetInnerHTML={{ __html: getStatusBadge(experiment.status) }} />
        </div>
        <div class="experiment-meta">
          <span class="experiment-date">
            Started:{' '}
            {new Date(experiment.startDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
          {experiment.duration && <span class="experiment-duration">{experiment.duration}</span>}
        </div>
        <div class="experiment-hypothesis">
          <strong>Hypothesis:</strong>
          <p>{experiment.hypothesis}</p>
        </div>
        <div class="experiment-view-details">View Details →</div>
      </div>
    </a>
  );
};

export const TeamDetailPage: FC<TeamDetailPageProps> = ({
  teams,
  team,
  capabilitiesByCategory,
  capabilityMap,
  practiceMap,
}) => {
  // Combine targeted and non-targeted capabilities
  const allTeamCapabilities = [...team.targetedCapabilities, ...team.nonTargetedCapabilities];
  const teamCapabilityMap = new Map(allTeamCapabilities.map(tc => [tc.id, tc]));

  return (
    <Page title={team.name} heading={team.name} activePage={team.id} teams={teams}>
      <div class="team-detail-container">
        {team.description && (
          <div class="team-description">
            <p>{team.description}</p>
          </div>
        )}

        <section class="team-section">
          <h2>Capabilities</h2>
          <p class="section-intro">
            The capabilities this team is working on, showing team-specific scores and trends.
          </p>
          <div class="capability-tiles-container">
            {/* Targeted capabilities */}
            {team.targetedCapabilities && team.targetedCapabilities.length > 0 ? (
              <div id="targeted-capabilities" class="capability-tiles-grid">
                {team.targetedCapabilities.map(tc => {
                  const capability = capabilityMap.get(tc.id);
                  if (!capability) {
                    return <div class="capability-tile error">Capability not found: {tc.id}</div>;
                  }
                  return <TeamCapabilityTile teamCapability={tc} capability={capability} />;
                })}
              </div>
            ) : (
              <p class="empty-state">No capabilities currently targeted.</p>
            )}

            {/* Expanded capabilities */}
            <div id="expanded-capabilities" class="expanded-capabilities">
              {Object.entries(capabilitiesByCategory).map(([category, capabilities]) => (
                <div class="capability-category-section">
                  <h3 class="capability-category-title">{category}</h3>
                  <div class="capability-tiles-grid">
                    {capabilities.map(capability => {
                      const teamCapability = teamCapabilityMap.get(capability.id);
                      if (teamCapability) {
                        return (
                          <TeamCapabilityTile
                            teamCapability={teamCapability}
                            capability={capability}
                          />
                        );
                      } else {
                        return (
                          <TeamCapabilityTile
                            teamCapability={{ id: capability.id, currentScore: 0, trend: 'stable' }}
                            capability={capability}
                          />
                        );
                      }
                    })}
                  </div>
                </div>
              ))}
            </div>

            <a class="toggle-view-link" id="toggle-view" href="#">
              View All Capabilities
            </a>
          </div>
        </section>

        <section class="team-section">
          <h2>Active Experiments</h2>
          <p class="section-intro">
            Engineering practices the team is experimenting with to improve their delivery
            performance.
          </p>
          {team.activeExperiments && team.activeExperiments.length > 0 ? (
            <div class="experiment-cards">
              {team.activeExperiments.map(exp => {
                const practice = practiceMap.get(exp.practiceId);
                const practiceName = practice ? practice.title : exp.practiceId;
                return <ExperimentCard experiment={exp} practiceName={practiceName} />;
              })}
            </div>
          ) : (
            <p class="empty-state">No active experiments at this time.</p>
          )}
        </section>

        <div class="team-actions">
          <a href="/" class="btn btn-secondary">
            ← Back to Overview
          </a>
          <a href="/catalog/capability/" class="btn btn-primary">
            View All Capabilities
          </a>
        </div>
      </div>

      <script src="/resources/public/team-detail.js"></script>
    </Page>
  );
};
