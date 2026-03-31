import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../../schemas/teamSchemas';
import type { MetricOption } from '../../domain/prepareInsightsData';

interface ExperimentOption {
  id: string;
  title: string;
  teamId: string;
  startDate: string | null;
  expectedDurationInWeeks: number | null;
}

export interface InsightsPageProps {
  teams: Team[];
  metricOptions: MetricOption[];
  capabilityMetricsJson: string;
  teamMetricsJson: string;
  availableDates: string[];
  experimentsJson: string;
}

interface MetricMultiSelectProps {
  id: string;
  chipsId: string;
  placeholder: string;
  metricOptions: MetricOption[];
}

const MetricMultiSelect: FC<MetricMultiSelectProps> = ({
  id,
  chipsId,
  placeholder,
  metricOptions,
}) => {
  const capabilityOptions = metricOptions.filter(opt => opt.type === 'capability');
  const teamOptions = metricOptions.filter(opt => opt.type === 'team-specific');

  return (
    <div class="insights-multiselect multiselect" id={id}>
      <button class="multiselect-toggle" type="button" data-placeholder={placeholder}>
        {placeholder}
      </button>
      <div class="multiselect-dropdown">
        <div class="multiselect-actions">
          <button type="button" class="multiselect-action" data-action="clear">
            Clear all
          </button>
        </div>
        {capabilityOptions.length > 0 && (
          <>
            <div class="multiselect-group-label">Capability Scores</div>
            {capabilityOptions.map(opt => (
              <label class="multiselect-option">
                <input type="checkbox" value={opt.id} data-label={opt.label} />
                {opt.label}
              </label>
            ))}
          </>
        )}
        {teamOptions.length > 0 && (
          <>
            <div class="multiselect-group-label">Team-Specific Metrics</div>
            {teamOptions.map(opt => (
              <label class="multiselect-option">
                <input type="checkbox" value={opt.id} data-label={opt.label} />
                {opt.label}
              </label>
            ))}
          </>
        )}
      </div>
      <div class="metric-chips" id={chipsId}></div>
    </div>
  );
};

export const InsightsPage: FC<InsightsPageProps> = ({
  teams,
  metricOptions,
  capabilityMetricsJson,
  teamMetricsJson,
  availableDates,
  experimentsJson,
}) => {
  const experiments: ExperimentOption[] = JSON.parse(experimentsJson);

  // Resolve team name for experiment display
  const teamNameMap = new Map(teams.map(t => [t.id, t.name]));
  const experimentLabel = (exp: ExperimentOption) => {
    const teamName = teamNameMap.get(exp.teamId) ?? exp.teamId;
    return `${teamName} — ${exp.title}`;
  };

  return (
    <Page title="Insights" heading="Metrics Insights" activePage="insights">
      <div class="insights-container">
        <div class="insights-controls">
          {/* Three-column axis / experiment selector grid */}
          <div class="controls-grid">
            {/* Left axis */}
            <div class="control-group">
              <label>
                Left Axis Metrics
                <span class="axis-label-badge axis-label-badge--left">L</span>
              </label>
              <MetricMultiSelect
                id="left-axis-select"
                chipsId="left-axis-chips"
                placeholder="Select left axis metrics..."
                metricOptions={metricOptions}
              />
            </div>

            {/* Right axis */}
            <div class="control-group">
              <label>
                Right Axis Metrics
                <span class="axis-label-badge axis-label-badge--right">R</span>
              </label>
              <MetricMultiSelect
                id="right-axis-select"
                chipsId="right-axis-chips"
                placeholder="Select right axis metrics..."
                metricOptions={metricOptions}
              />
            </div>

            {/* Experiment overlays */}
            <div class="control-group">
              <label>Experiment Overlays</label>
              <div class="insights-multiselect multiselect" id="experiment-select">
                <button
                  class="multiselect-toggle"
                  type="button"
                  data-placeholder="Select experiments..."
                >
                  Select experiments...
                </button>
                <div class="multiselect-dropdown">
                  <div class="multiselect-actions">
                    <button type="button" class="multiselect-action" data-action="clear">
                      Clear all
                    </button>
                  </div>
                  {experiments.length === 0 ? (
                    <div class="multiselect-empty">No experiments available</div>
                  ) : (
                    experiments.map(exp => (
                      <label class="multiselect-option">
                        <input type="checkbox" value={exp.id} data-label={experimentLabel(exp)} />
                        {experimentLabel(exp)}
                      </label>
                    ))
                  )}
                </div>
                <div class="metric-chips" id="experiment-chips"></div>
              </div>
            </div>
          </div>

          {/* Date range */}
          <div class="control-group date-range">
            <div class="date-input-group">
              <label for="start-date">Start Date:</label>
              <input
                type="date"
                id="start-date"
                class="date-input"
                data-initial-value={availableDates.length > 0 ? availableDates[0] : ''}
              />
            </div>
            <div class="date-input-group">
              <label for="end-date">End Date:</label>
              <input
                type="date"
                id="end-date"
                class="date-input"
                data-initial-value={
                  availableDates.length > 0 ? availableDates[availableDates.length - 1] : ''
                }
              />
            </div>
          </div>
        </div>

        <div class="chart-container">
          <canvas id="metrics-chart"></canvas>
          <div id="chart-zoom-controls" class="chart-zoom-controls" style="display:none">
            <button id="zoom-out" class="btn btn-outline btn-left">
              <i class="fa-solid fa-magnifying-glass-minus"></i>
            </button>
            <button id="zoom-in" class="btn btn-outline btn-middle">
              <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>
            <button id="reset-zoom" class="btn btn-outline btn-right">
              <i class="fa-solid fa-arrow-rotate-left"></i>
            </button>
          </div>
        </div>

        <div id="chart-message" class="chart-message">
          Select metrics for the left or right axis to view data
        </div>
      </div>

      {/* Load Chart.js and plugins from CDN */}
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>

      {/* Pass data to client-side script */}
      <script
        id="metrics-data"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            capabilityMetrics: capabilityMetricsJson,
            teamMetrics: teamMetricsJson,
            availableDates,
            teams: teams.map(t => ({ id: t.id, name: t.name })),
            experiments: experiments,
            metricOptions: metricOptions.map(o => ({ id: o.id, label: o.label, type: o.type })),
          }),
        }}
      />
      <script src="/public/insights.js"></script>
    </Page>
  );
};
