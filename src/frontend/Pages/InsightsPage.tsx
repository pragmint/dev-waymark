import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../../schemas/teamSchemas';

export interface InsightsPageProps {
  teams: Team[];
  availableDates: string[];
}

export const InsightsPage: FC<InsightsPageProps> = ({ teams, availableDates }) => {
  return (
    <Page title="Insights" heading="Metrics Insights" activePage="insights">
      <div class="insights-container">
        <div class="insights-controls">
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
          Chart visualization will be implemented here
        </div>
      </div>

      {/* Load Chart.js and plugins from CDN */}
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>

      {/* Pass data to client-side script */}
      <script
        id="metrics-data"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            availableDates,
            teams: teams.map(t => ({ id: t.id, name: t.name })),
          }),
        }}
      />
      <script src="/public/insights.js"></script>
    </Page>
  );
};
