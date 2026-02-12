import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../../core/data/teamTypes';
import type { MetricOption } from './handlers/InsightsHandler';

interface InsightsPageProps {
  teams: Team[];
  metricOptions: MetricOption[];
  capabilityMetricsJson: string;
  teamMetricsJson: string;
  availableDates: string[];
}

export const InsightsPage: FC<InsightsPageProps> = ({
  teams,
  metricOptions,
  capabilityMetricsJson,
  teamMetricsJson,
  availableDates,
}) => {
  return (
    <Page title="Insights" heading="Metrics Insights" activePage="insights" teams={teams}>
      <div class="insights-container">
        <div class="insights-controls">
          <div class="control-group">
            <label for="metric-select">Select Metric:</label>
            <select id="metric-select" class="metric-select">
              <option value="">-- Select a metric --</option>
              <optgroup label="Capability Scores">
                {metricOptions
                  .filter(opt => opt.type === 'capability')
                  .map(opt => (
                    <option value={opt.id}>{opt.label}</option>
                  ))}
              </optgroup>
              {metricOptions.some(opt => opt.type === 'team-specific') && (
                <optgroup label="Team-Specific Metrics">
                  {metricOptions
                    .filter(opt => opt.type === 'team-specific')
                    .map(opt => (
                      <option value={opt.id}>{opt.label}</option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>

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
        </div>

        <div id="chart-message" class="chart-message">
          Select a metric to view data
        </div>
      </div>

      {/* Load Chart.js from CDN */}
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>

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
          }),
        }}
      />
      <script src="/resources/public/insights.js"></script>
    </Page>
  );
};
