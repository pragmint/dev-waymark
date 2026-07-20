import type { FC } from 'hono/jsx';
import type { Dashboard } from '../../schemas/dashboard';
import type { Preset } from '../../schemas/preset';
import type { VisualizationSummary } from '../../schemas/visualization';
import type { ChartJsConfig } from '../../domain/chartDataBuilder';
import type { DateRange } from '../../domain/dateRange';
import { TEMPLATES } from '../../schemas/visualizationTemplate';
import { Layout } from '../components/Layout';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

export type DashboardCardComparison = {
  label: string;
  chartJsConfig: ChartJsConfig;
  pointUrls: (string | null)[];
  smoothingPointUrls: (string | null)[] | null;
  smoothingDatasetIndex: number | null;
  warnings: string[];
  excludedEntityCount: number;
  excludedEntitiesUrl: string | null;
};

export type DashboardCard = {
  id: number;
  name: string;
  chartJsConfig: ChartJsConfig;
  pointUrls: (string | null)[];
  smoothingPointUrls: (string | null)[] | null;
  smoothingDatasetIndex: number | null;
  warnings: string[];
  excludedEntityCount: number;
  excludedEntitiesUrl: string | null;
  layout: 'normal' | 'wide';
  // The immediately preceding period's data, when "Compare Time Periods" is on
  // and this viz has a resolvable date field. Null otherwise.
  comparison: DashboardCardComparison | null;
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
              <DashboardCardView
                card={card}
                dashboardCount={vizDashboardCounts[card.id] ?? 1}
                dateRangeLabel={dateRangeLabel}
              />
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
      <dialog id="waymark-modal" class="waymark-dialog" />
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
          action={`/visualizations/dashboards/${selectedDashboard.id}/duplicate`}
          class="filter-inline-form"
          data-dashboard-duplicate-form
        >
          <button
            type="submit"
            class="filter-icon-btn"
            title={`Duplicate "${selectedDashboard.name}"`}
            aria-label={`Duplicate dashboard ${selectedDashboard.name}`}
          >
            ⧉
          </button>
        </form>
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

      <label class="date-range-compare" hidden={dateRange.period === 'all'}>
        <input type="checkbox" data-date-range-compare checked={dateRange.compare} />
        Compare Time Periods
      </label>

      <div
        class="date-range-compare-custom"
        hidden={!(dateRange.period === 'custom' && dateRange.compare)}
      >
        <span class="date-range-compare-custom-label">Compare to</span>
        <input
          type="date"
          class="filter-input date-range-date-input"
          data-date-range-compare-custom-start
          value={dateRange.compareCustomStart ?? ''}
          aria-label="Comparison range start"
        />
        <span class="date-range-dash">–</span>
        <input
          type="date"
          class="filter-input date-range-date-input"
          data-date-range-compare-custom-end
          value={dateRange.compareCustomEnd ?? ''}
          aria-label="Comparison range end"
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

const WarningIndicator: FC<{
  warnings: string[];
  excludedEntitiesUrl: string | null;
  comparison?: DashboardCardComparison | null;
}> = ({ warnings, excludedEntitiesUrl, comparison }) => (
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
      {comparison?.warnings.map(w => (
        <p class="warning">
          {comparison.label}: {w}
        </p>
      ))}
      {comparison?.excludedEntitiesUrl && (
        <p class="warning">
          <a class="warning-link" href={comparison.excludedEntitiesUrl}>
            View excluded entities ({comparison.label}) →
          </a>
        </p>
      )}
    </span>
  </span>
);

// Sizing class while comparing two periods: a normal card grows to the
// existing "wide" footprint (one section per panel); a wide card grows to a
// new "extra-wide" footprint (1.5 sections per panel) instead of doubling
// again, so it doesn't dominate the grid.
function cardSizeClass(card: DashboardCard): string {
  if (card.comparison)
    return card.layout === 'wide' ? ' dashboard-viz-card--extra-wide' : ' dashboard-viz-card--wide';
  return card.layout === 'wide' ? ' dashboard-viz-card--wide' : '';
}

const CardCanvas: FC<{
  chartJsConfig: ChartJsConfig;
  pointUrls: (string | null)[];
  smoothingPointUrls: (string | null)[] | null;
  smoothingDatasetIndex: number | null;
}> = ({ chartJsConfig, pointUrls, smoothingPointUrls, smoothingDatasetIndex }) => (
  <div class="dashboard-viz-canvas-wrap">
    <canvas
      class="dashboard-viz-canvas"
      data-config={JSON.stringify(chartJsConfig)}
      data-point-urls={JSON.stringify(pointUrls)}
      data-smoothing-point-urls={JSON.stringify(smoothingPointUrls)}
      data-smoothing-dataset-index={JSON.stringify(smoothingDatasetIndex)}
    />
  </div>
);

const DashboardCardView: FC<{
  card: DashboardCard;
  dashboardCount: number;
  dateRangeLabel: string;
}> = ({ card, dashboardCount, dateRangeLabel }) => (
  <div class={`dashboard-viz-card${cardSizeClass(card)}`} data-viz-id={card.id} draggable={true}>
    <div class="dashboard-viz-card-header">
      <span class="dashboard-viz-card-grip" aria-hidden="true">
        ⋮⋮
      </span>
      <span class="dashboard-viz-card-title">{card.name}</span>
      {(card.warnings.length > 0 || (card.comparison?.warnings.length ?? 0) > 0) && (
        <WarningIndicator
          warnings={card.warnings}
          excludedEntitiesUrl={card.excludedEntitiesUrl}
          comparison={card.comparison}
        />
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
        class="dashboard-viz-waymark-btn"
        data-waymark-viz={card.id}
        title="Waymarks"
        aria-label={`Waymarks for ${card.name}`}
      >
        <svg viewBox="0 0 32 32" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16 2a10 10 0 0 0-10 10c0 7.5 10 18 10 18s10-10.5 10-18A10 10 0 0 0 16 2zm0 13.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
          />
        </svg>
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
    <div class="dashboard-viz-chart-area" data-chart-area>
      {card.comparison ? (
        // Chronological order: the comparison period is always earlier than
        // the selected one, so it renders on the left with the current
        // period on the right.
        <div class="dashboard-viz-compare-panels">
          <div class="dashboard-viz-panel">
            <div class="dashboard-viz-panel-label">{card.comparison.label}</div>
            <CardCanvas
              chartJsConfig={card.comparison.chartJsConfig}
              pointUrls={card.comparison.pointUrls}
              smoothingPointUrls={card.comparison.smoothingPointUrls}
              smoothingDatasetIndex={card.comparison.smoothingDatasetIndex}
            />
          </div>
          <div class="dashboard-viz-panel">
            <div class="dashboard-viz-panel-label">{dateRangeLabel}</div>
            <CardCanvas
              chartJsConfig={card.chartJsConfig}
              pointUrls={card.pointUrls}
              smoothingPointUrls={card.smoothingPointUrls}
              smoothingDatasetIndex={card.smoothingDatasetIndex}
            />
          </div>
        </div>
      ) : (
        <CardCanvas
          chartJsConfig={card.chartJsConfig}
          pointUrls={card.pointUrls}
          smoothingPointUrls={card.smoothingPointUrls}
          smoothingDatasetIndex={card.smoothingDatasetIndex}
        />
      )}
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
