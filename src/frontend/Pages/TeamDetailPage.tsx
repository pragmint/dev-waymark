import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import { TeamCapabilityTile } from '../components/TeamCapabilityTile';
import { CapabilityBadge } from '../components/CapabilityBadge';
import { MiniChart, type MiniChartData } from '../components/MiniChart';
import type { Team, TeamCapability } from '../../schemas/teamSchemas';
import type { Experiment } from '../../schemas/experimentSchemas';
import type { Capability } from '../../schemas/capabilitySchemas';
import type { Practice } from '../../loaders/loadPracticeFromFilesystem';
import type { TeamMetric } from '../../schemas/metricSchemas';
import { parseDate } from '../../domain/parseDate';
import { compareExperimentsByStatus } from '../../domain/experimentQueries';

const METRIC_NAME_ACRONYMS: Record<string, string> = {
  wip: 'WIP',
  pr: 'PR',
  qa: 'QA',
};

function formatMetricName(metricName: string): string {
  return metricName
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(w => METRIC_NAME_ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function toMiniChartData(metric: TeamMetric): MiniChartData | null {
  const numericPoints = metric.data.filter(d => typeof d.value === 'number');
  if (numericPoints.length === 0) return null;
  return {
    labels: numericPoints.map(d => d.date),
    datasets: [
      {
        label: formatMetricName(metric.metricName),
        data: numericPoints.map(d => d.value as number),
        borderColor: 'rgb(42, 171, 133)',
        backgroundColor: 'rgba(42, 171, 133, 0.2)',
      },
    ],
  };
}

function getStatusBadge(status: Experiment['status']): string {
  const statusColors: Record<Experiment['status'], { bg: string; text: string }> = {
    active: { bg: '#e8f5f0', text: '#228b6b' },
    backlog: { bg: '#e0ecf8', text: '#2a6cb8' },
    blocked: { bg: '#f8d7da', text: '#721c24' },
    polish: { bg: '#fff3e0', text: '#ef8e59' },
    pitch: { bg: '#ede8f8', text: '#5b3ea8' },
  };

  const colors = statusColors[status];
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

const ExperimentFilter: FC<{
  allCapabilities: Capability[];
}> = ({ allCapabilities }) => {
  if (allCapabilities.length === 0) return <></>;

  const capabilities = allCapabilities
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div class="experiment-filter">
      <label class="filter-label">Filter by capability:</label>
      <div class="multiselect" id="capability-filter">
        <button class="multiselect-toggle" type="button">
          All capabilities &#x25BE;
        </button>
        <div class="multiselect-dropdown">
          <div class="multiselect-actions">
            <button type="button" class="multiselect-action" data-action="select-all">
              Select all
            </button>
            <button type="button" class="multiselect-action" data-action="deselect-all">
              Deselect all
            </button>
          </div>
          {capabilities.map(cap => (
            <label class="multiselect-option">
              <input type="checkbox" value={cap.id} checked />
              {cap.name}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export const TeamDetailPage: FC<TeamDetailPageProps> = ({
  team,
  allCapabilities,
  capabilityMap,
  teamCapabilityMap,
  practiceMap,
  experiments,
  teamMetrics,
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
            <>
              <ExperimentFilter allCapabilities={allCapabilities} />
              <div class="experiment-cards">
                {experiments.sort(compareExperimentsByStatus).map(exp => {
                  const practice = practiceMap.get(exp.intervention.practiceUnderTest);
                  const practiceName = practice
                    ? practice.title
                    : exp.intervention.practiceUnderTest;
                  return (
                    <ExperimentCard
                      experiment={exp}
                      practiceName={practiceName}
                      capabilityMap={capabilityMap}
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <p class="empty-state">No active experiments at this time.</p>
          )}
        </section>

        {teamMetrics.length > 0 && (
          <section class="team-section">
            <h2>Metrics</h2>
            <p class="section-intro">Team-specific time-series metrics collected over time.</p>
            <div class="team-metrics-grid">
              {teamMetrics.map(metric => (
                <div class="team-metric-card">
                  <h3 class="team-metric-title">{formatMetricName(metric.metricName)}</h3>
                  <MiniChart chartData={toMiniChartData(metric)} metricId={metric.metricName} />
                </div>
              ))}
            </div>
          </section>
        )}

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
      <script type="module" src="/public/mini-chart.js"></script>
    </Page>
  );
};

const ExperimentCard: FC<{
  experiment: Experiment;
  practiceName: string;
  capabilityMap: Map<string, Capability>;
}> = ({ experiment, practiceName, capabilityMap }) => {
  const duration = experiment.expectedDurationInWeeks
    ? `${experiment.expectedDurationInWeeks} weeks`
    : undefined;

  // Resolve capability IDs to names
  const capabilityIds = experiment.intervention.relatedCapabilities || [];
  const capabilityNames = capabilityIds
    .map(capId => capabilityMap.get(capId)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div class="experiment-card" data-capability-ids={JSON.stringify(capabilityIds)}>
      <div class="experiment-header">
        <h3>
          <a href={`/experiment/${experiment.id}/`}>{experiment.title}</a>
        </h3>
        <span dangerouslySetInnerHTML={{ __html: getStatusBadge(experiment.status) }} />
      </div>
      {capabilityNames.length > 0 && (
        <div class="experiment-capabilities">
          {capabilityNames.map(name => (
            <CapabilityBadge capabilityName={name} />
          ))}
        </div>
      )}
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
