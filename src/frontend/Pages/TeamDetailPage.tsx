import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { TeamCapabilityTile } from '../components/TeamCapabilityTile';
import type { Team, TeamCapability } from '../../schemas/teamSchemas';
import type { Experiment } from '../../schemas/experimentSchemas';
import type { Capability } from '../../schemas/capabilitySchemas';
import type { Practice } from '../../loaders/loadPracticeFromFilesystem';
import type { TeamMetric } from '../../schemas/metricSchemas';
import { parseDate } from '../../domain/parseDate';

function getStatusBadge(status: string): string {
  const statusColors: Record<string, { bg: string; text: string }> = {
    'in-progress': { bg: '#e8f5f0', text: '#228b6b' },
    blocked: { bg: '#f8d7da', text: '#721c24' },
    paused: { bg: '#fff3cd', text: '#856404' },
  };

  const colors = statusColors[status] || { bg: '#e0e0e0', text: '#666' };
  const label = status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return `<span class="status-badge" style="background-color: ${colors.bg}; color: ${colors.text};">${label}</span>`;
}

export interface TeamDetailPageProps {
  team: Team;
  allCapabilities: Capability[];
  capabilityMap: Map<string, Capability>;
  teamCapabilityMap: Map<string, TeamCapability>;
  practiceMap: Map<string, Practice>;
  experiments: Experiment[];
  teamMetrics: TeamMetric[];
}

export const TeamDetailPage: FC<TeamDetailPageProps> = ({
  team,
  allCapabilities,
  capabilityMap,
  teamCapabilityMap,
  practiceMap,
  experiments,
  teamMetrics: _teamMetrics,
}) => {
  return (
    <Page title={team.name} heading={team.name} activePage={team.id}>
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
                  // Handle both string and object formats
                  const capabilityId = typeof tc === 'string' ? tc : tc.id;
                  const teamCapability =
                    typeof tc === 'string' ? teamCapabilityMap.get(capabilityId) : tc;

                  const capability = capabilityMap.get(capabilityId);

                  if (!capability || !teamCapability) {
                    return (
                      <div class="capability-tile error">Capability not found: {capabilityId}</div>
                    );
                  }

                  return (
                    <TeamCapabilityTile
                      teamCapability={teamCapability}
                      capability={capability}
                      teamId={team.id}
                    />
                  );
                })}
              </div>
            ) : (
              <p class="empty-state">No capabilities currently targeted.</p>
            )}

            {/* Expanded capabilities */}
            <div id="expanded-capabilities" class="expanded-capabilities">
              <div class="capability-tiles-grid">
                {allCapabilities.map(capability => {
                  const teamCapability = teamCapabilityMap.get(capability.id);
                  // teamCapabilityMap is always populated by the handler, so teamCapability should exist
                  if (!teamCapability) {
                    // Fallback (should not happen)
                    return (
                      <TeamCapabilityTile
                        teamCapability={{ id: capability.id, currentScore: null, trend: null }}
                        capability={capability}
                        teamId={team.id}
                      />
                    );
                  }
                  return (
                    <TeamCapabilityTile
                      teamCapability={teamCapability}
                      capability={capability}
                      teamId={team.id}
                    />
                  );
                })}
              </div>
            </div>

            <a class="toggle-view-link" id="toggle-view" href="#">
              View All Capabilities
            </a>
          </div>
        </section>

        <section class="team-section">
          <h2>Experiments</h2>
          <p class="section-intro">
            Engineering practices the team is considering experimenting with to improve their
            delivery performance.
          </p>
          {experiments && experiments.length > 0 ? (
            <div class="experiment-cards">
              {experiments.map(exp => {
                const practice = practiceMap.get(exp.intervention.practiceUnderTest);
                const practiceName = practice ? practice.title : exp.intervention.practiceUnderTest;
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

      <script src="/public/team-detail.js"></script>
    </Page>
  );
};

const ExperimentCard: FC<{ experiment: Experiment; practiceName: string }> = ({
  experiment,
  practiceName,
}) => {
  const duration = experiment.expectedDurationInWeeks
    ? `${experiment.expectedDurationInWeeks} weeks`
    : undefined;

  return (
    <div class="experiment-card">
      <div class="experiment-header">
        <h3>
          <a href={`/experiment/${experiment.id}/`}>{experiment.title}</a>
        </h3>
        <span dangerouslySetInnerHTML={{ __html: getStatusBadge(experiment.status) }} />
      </div>
      <div class="experiment-supporting-practice">
        Supporting practice:{' '}
        <a href={`/catalog/practice/${experiment.intervention.practiceUnderTest}/`}>
          {practiceName}
        </a>
      </div>
      <div class="experiment-meta">
        <span class="experiment-date">
          Started:{' '}
          {experiment.startDate
            ? parseDate(experiment.startDate).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : 'TBD'}
        </span>
        {duration && <span class="experiment-duration">{duration}</span>}
      </div>
      <div class="experiment-hypothesis">
        <strong>Hypothesis:</strong>
        <p>{experiment.hypothesis.statement}</p>
      </div>
      <div class="experiment-view-details">
        <a href={`/experiment/${experiment.id}/`}>View Details →</a>
      </div>
    </div>
  );
};
