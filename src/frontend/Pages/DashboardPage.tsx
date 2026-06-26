import type { FC } from 'hono/jsx';
import type { Dashboard } from '../../schemas/dashboard';
import type { Preset } from '../../schemas/preset';
import type { VisualizationSummary } from '../../schemas/visualization';
import type { ChartJsConfig } from '../../domain/chartDataBuilder';
import type { DateRange } from '../../domain/dateRange';
import { TEMPLATES } from '../../schemas/visualizationTemplate';
import { Layout } from '../components/Layout';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

export type DashboardCard = {
  id: number;
  name: string;
  chartJsConfig: ChartJsConfig;
  pointUrls: string[];
  warnings: string[];
  excludedEntityCount: number;
  excludedEntitiesUrl: string | null;
};

type Props = {
  dashboards: Dashboard[];
  selectedDashboard: { id: number; name: string; visualizationIds: number[] } | null;
  cards: DashboardCard[];
  /** Existing visualizations not currently on the selected dashboard. Empty list when no dashboard is selected. */
  availableVisualizations: VisualizationSummary[];
  vizDashboardCounts: Record<number, number>;
  presets: Preset[];
  dateRange: DateRange;
  dateRangeLabel: string;
};

export const DashboardPage: FC<Props> = ({
  dashboards,
  selectedDashboard,
  cards,
  availableVisualizations,
  vizDashboardCounts,
  presets,
  dateRange,
  dateRangeLabel,
}) => {
  const dashboardConfig = {
    dashboardId: selectedDashboard?.id ?? null,
  };
  const savedVizIds = selectedDashboard?.visualizationIds ?? [];

  return (
    <Layout title="Visualizations" extraScripts={[CHART_JS_CDN, '/dashboard.js']}>
      <div class="page-header">
        <h1>Visualizations</h1>
      </div>

      <div class="dashboard-controls">
        <DashboardMetaRow dashboards={dashboards} selectedDashboard={selectedDashboard} />

        {selectedDashboard && (
          <DateRangeRow dateRange={dateRange} dateRangeLabel={dateRangeLabel} />
        )}
      </div>

      {!selectedDashboard ? (
        <EmptyState hasAnyDashboards={dashboards.length > 0} />
      ) : (
        <>
          <div class="dashboard-viz-grid" data-viz-grid>
            {cards.map(card => (
              <DashboardCardView card={card} dashboardCount={vizDashboardCounts[card.id] ?? 1} />
            ))}
          </div>

          <AddVizPicker availableVisualizations={availableVisualizations} />
        </>
      )}

      <script
        id="dashboard-config"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(dashboardConfig) }}
      />
      <script
        id="dashboard-saved-viz-ids"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(savedVizIds) }}
      />
      <script
        id="dashboards-list"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(dashboards) }}
      />
      <script
        id="viz-dashboard-counts"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(vizDashboardCounts) }}
      />
      <script
        id="presets-list"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(presets) }}
      />
      <script
        id="date-range-config"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(dateRange) }}
      />
      <script
        id="templates-list"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(TEMPLATES) }}
      />

      <dialog id="viz-create-modal" class="viz-modal" />
    </Layout>
  );
};

const DashboardMetaRow: FC<{
  dashboards: Dashboard[];
  selectedDashboard: { id: number; name: string } | null;
}> = ({ dashboards, selectedDashboard }) => (
  <div class="filter-meta-row">
    <label class="filter-widget-label" for="dashboard-combo-input">
      Dashboard
    </label>

    {selectedDashboard ? (
      <div class="preset-combo-wrap" data-dashboard-save-changes>
        <div class="preset-combo" data-dashboard-combo>
          <input
            id="dashboard-combo-input"
            type="text"
            class="preset-combo-input"
            value={selectedDashboard.name}
            data-original-name={selectedDashboard.name}
            data-dashboard-name-input
            autocomplete="off"
            required
          />
          <button
            type="button"
            class="preset-combo-toggle"
            data-dashboard-combo-toggle
            aria-haspopup="listbox"
            aria-expanded="false"
            aria-label="Pick a different dashboard"
          >
            ▾
          </button>
          <ul class="preset-combo-list" hidden data-dashboard-combo-list role="listbox">
            <li>
              <a href="/visualizations" role="option">
                None
              </a>
            </li>
            {dashboards
              .filter(d => d.id !== selectedDashboard.id)
              .map(d => (
                <li>
                  <a href={`/visualizations?dashboard=${d.id}`} role="option">
                    {d.name}
                  </a>
                </li>
              ))}
          </ul>
        </div>
        <button
          type="button"
          class="filter-btn filter-btn-attention"
          data-dashboard-save-submit
          data-dashboard-id={String(selectedDashboard.id)}
          hidden
        >
          <span aria-hidden="true" class="filter-btn-dot">
            ●
          </span>{' '}
          Save changes
        </button>
        <form
          method="post"
          action={`/visualizations/dashboards/${selectedDashboard.id}/delete`}
          class="filter-inline-form"
          data-dashboard-delete-form
          data-dashboard-name={selectedDashboard.name}
        >
          <button
            type="submit"
            class="filter-icon-btn"
            title={`Delete "${selectedDashboard.name}"`}
            aria-label={`Delete dashboard ${selectedDashboard.name}`}
          >
            🗑
          </button>
        </form>
      </div>
    ) : (
      <>
        <select id="dashboard-combo-input" class="filter-select" data-dashboard-select>
          <option value="">— Pick a dashboard —</option>
          {dashboards.map(d => (
            <option value={`/visualizations?dashboard=${d.id}`} data-dashboard-id={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" class="filter-btn" data-dashboard-create-open>
          + Create dashboard
        </button>
      </>
    )}

    <div class="dashboard-create-panel" hidden data-dashboard-create-panel>
      <form
        method="post"
        action="/visualizations/dashboards"
        class="filter-inline-form"
        data-dashboard-create-form
      >
        <input
          type="text"
          name="name"
          class="filter-input"
          placeholder="Dashboard name"
          required
          data-dashboard-create-input
        />
        <button type="submit" class="filter-btn">
          Save
        </button>
        <button type="button" class="filter-btn" data-dashboard-create-cancel>
          Cancel
        </button>
      </form>
    </div>
  </div>
);

const DateRangeRow: FC<{ dateRange: DateRange; dateRangeLabel: string }> = ({
  dateRange,
  dateRangeLabel,
}) => {
  const isStepper =
    dateRange.period === 'week' ||
    dateRange.period === 'month' ||
    dateRange.period === 'quarter' ||
    dateRange.period === 'year';
  return (
    <div class="dashboard-date-range-row" data-date-range-row>
      <label class="filter-widget-label" for="date-range-period">
        Range
      </label>
      <select id="date-range-period" class="filter-select date-range-period" data-date-range-period>
        <option value="all" selected={dateRange.period === 'all'}>
          All time
        </option>
        <option value="week" selected={dateRange.period === 'week'}>
          Week
        </option>
        <option value="month" selected={dateRange.period === 'month'}>
          Month
        </option>
        <option value="quarter" selected={dateRange.period === 'quarter'}>
          Quarter
        </option>
        <option value="year" selected={dateRange.period === 'year'}>
          Year
        </option>
        <option value="custom" selected={dateRange.period === 'custom'}>
          Custom
        </option>
      </select>

      <div class="date-range-stepper" hidden={!isStepper}>
        <button
          type="button"
          class="filter-icon-btn date-range-arrow"
          data-date-range-prev
          aria-label="Previous period"
          title="Previous period"
        >
          ‹
        </button>
        <span class="date-range-label" data-date-range-label>
          {dateRangeLabel}
        </span>
        <button
          type="button"
          class="filter-icon-btn date-range-arrow"
          data-date-range-next
          aria-label="Next period"
          title="Next period"
        >
          ›
        </button>
      </div>

      <div class="date-range-custom" hidden={dateRange.period !== 'custom'}>
        <input
          type="date"
          class="filter-input date-range-date-input"
          data-date-range-custom-start
          value={dateRange.customStart ?? ''}
          aria-label="Range start"
        />
        <span class="date-range-dash">–</span>
        <input
          type="date"
          class="filter-input date-range-date-input"
          data-date-range-custom-end
          value={dateRange.customEnd ?? ''}
          aria-label="Range end"
        />
      </div>
    </div>
  );
};

const EmptyState: FC<{ hasAnyDashboards: boolean }> = ({ hasAnyDashboards }) => (
  <div class="dashboard-empty">
    {hasAnyDashboards ? (
      <p class="empty">Pick a dashboard above to view its visualizations.</p>
    ) : (
      <>
        <p class="empty">No dashboards yet.</p>
        <button type="button" class="filter-btn" data-dashboard-create-open>
          Create your first dashboard
        </button>
      </>
    )}
  </div>
);

const WarningIndicator: FC<{ warnings: string[]; excludedEntitiesUrl: string | null }> = ({
  warnings,
  excludedEntitiesUrl,
}) => (
  <span class="warning-indicator" tabIndex={0} aria-label="Visualization warnings">
    <span class="warning-icon" aria-hidden="true">
      !
    </span>
    <span class="warning-popover" role="tooltip">
      {warnings.map(w => (
        <p class="warning">{w}</p>
      ))}
      {excludedEntitiesUrl && (
        <p class="warning">
          <a class="warning-link" href={excludedEntitiesUrl}>
            View excluded entities →
          </a>
        </p>
      )}
    </span>
  </span>
);

const DashboardCardView: FC<{ card: DashboardCard; dashboardCount: number }> = ({
  card,
  dashboardCount,
}) => (
  <div class="dashboard-viz-card" data-viz-id={card.id} draggable={true}>
    <div class="dashboard-viz-card-header">
      <span class="dashboard-viz-card-title">{card.name}</span>
      {card.warnings.length > 0 && (
        <WarningIndicator warnings={card.warnings} excludedEntitiesUrl={card.excludedEntitiesUrl} />
      )}
      <button
        type="button"
        class="dashboard-viz-edit-btn"
        data-edit-viz={card.id}
        title="Edit"
        aria-label={`Edit ${card.name}`}
      >
        ✎
      </button>
      <button
        type="button"
        class="dashboard-viz-remove-btn"
        data-remove-viz={card.id}
        data-on-multiple={dashboardCount > 1 ? 'true' : 'false'}
        title={dashboardCount > 1 ? `On ${dashboardCount} dashboards` : 'Remove from dashboard'}
        aria-label={`Remove ${card.name} from dashboard`}
      >
        ×
      </button>
    </div>
    <div class="dashboard-viz-canvas-wrap">
      <canvas
        class="dashboard-viz-canvas"
        data-config={JSON.stringify(card.chartJsConfig)}
        data-point-urls={JSON.stringify(card.pointUrls)}
      />
    </div>
  </div>
);

const AddVizPicker: FC<{ availableVisualizations: VisualizationSummary[] }> = ({
  availableVisualizations,
}) => (
  <div class="dashboard-add-viz-row">
    <select class="filter-select add-viz-select" data-add-viz defaultValue="">
      <option value="">+ Add visualization</option>
      {availableVisualizations.length > 0 && (
        <optgroup label="Existing">
          {availableVisualizations.map(v => (
            <option value={String(v.id)}>{v.name}</option>
          ))}
        </optgroup>
      )}
      <optgroup label="New">
        <option value="__new__">Create new visualization…</option>
      </optgroup>
    </select>
  </div>
);
