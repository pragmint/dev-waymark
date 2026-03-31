// Main orchestration for insights page

import { ChartManager, type AxisConfig } from './insights-chart';
import {
  transformTeamMetricData,
  transformCapabilityMetricData,
  buildMultiAxisChartData,
  type CapabilityMetric,
  type TeamMetric,
  type TeamInfo,
  type ChartData,
} from './insights-data';
import { dataDateToInputDate, inputDateToDataDate, parseDataDate } from './insights-date-utils';
import type { ExperimentOverlayInfo } from './chart-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperimentOption {
  id: string;
  title: string;
  teamId: string;
  startDate: string | null;
  expectedDurationInWeeks: number | null;
}

interface MetricOptionInfo {
  id: string;
  label: string;
  type: 'capability' | 'team-specific';
}

interface AppDataRaw {
  capabilityMetrics: string;
  teamMetrics: string;
  availableDates: string[];
  teams: TeamInfo[];
  experiments: ExperimentOption[];
  metricOptions: MetricOptionInfo[];
}

interface AppData {
  capabilityMetrics: CapabilityMetric[];
  teamMetrics: TeamMetric[];
  teams: TeamInfo[];
  experiments: ExperimentOption[];
  metricOptions: MetricOptionInfo[];
  availableDates: string[];
}

interface InsightsState {
  leftAxisIds: Set<string>;
  rightAxisIds: Set<string>;
  experimentIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadAppData(): AppData | null {
  const el = document.getElementById('metrics-data');
  if (!el || !el.textContent) return null;

  try {
    const raw: AppDataRaw = JSON.parse(el.textContent);
    return {
      capabilityMetrics: JSON.parse(raw.capabilityMetrics),
      teamMetrics: JSON.parse(raw.teamMetrics),
      teams: raw.teams,
      experiments: raw.experiments ?? [],
      metricOptions: raw.metricOptions ?? [],
      availableDates: raw.availableDates,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metric data retrieval
// ---------------------------------------------------------------------------

function getMetricChartData(
  metricId: string,
  capabilityMetrics: CapabilityMetric[],
  teamMetrics: TeamMetric[],
  teams: TeamInfo[],
  startDate: string,
  endDate: string,
  metricLabel?: string
): ChartData | null {
  const isTeamSpecific = metricId.includes(':');

  if (isTeamSpecific) {
    const [teamId, teamMetricName] = metricId.split(':');
    const metric = teamMetrics.find(m => m.teamId === teamId && m.metricName === teamMetricName);
    if (!metric || metric.data.length === 0) return null;
    return transformTeamMetricData(metric, startDate, endDate, teams);
  } else {
    const metric = capabilityMetrics.find(m => m.capabilityId === metricId);
    if (!metric || metric.data.length === 0) return null;
    return transformCapabilityMetricData(metric, startDate, endDate, teams, metricLabel);
  }
}

// ---------------------------------------------------------------------------
// Multi-select controller
// ---------------------------------------------------------------------------

/**
 * Initialises a multi-select widget.
 *
 * The caller provides a shared `selectedSet` that is mutated directly so that
 * the caller can read the current selection at any time without going through
 * the DOM.  The returned function, when called, refreshes the disabled states
 * of all checkboxes based on the latest result of `getDisabled()`.
 */
function setupMultiSelect(
  containerId: string,
  chipsContainerId: string,
  chipClass: string,
  selectedSet: Set<string>,
  onChange: () => void,
  getDisabled: () => Set<string>
): (() => void) | null {
  const container = document.getElementById(containerId);
  const chipsContainer = document.getElementById(chipsContainerId);
  if (!container || !chipsContainer) return null;

  const toggle = container.querySelector<HTMLButtonElement>('.multiselect-toggle');
  const dropdown = container.querySelector<HTMLElement>('.multiselect-dropdown');
  if (!toggle || !dropdown) return null;

  const placeholder = toggle.getAttribute('data-placeholder') ?? 'Select...';

  // Build label map from data-label attributes on every checkbox
  const labelMap = new Map<string, string>();
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
    labelMap.set(cb.value, cb.getAttribute('data-label') ?? cb.value);
  });

  // ------------------------------------------------------------------
  // Toggle button
  // ------------------------------------------------------------------
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', e => {
    if (!container.contains(e.target as Node)) {
      dropdown.classList.remove('open');
    }
  });

  // ------------------------------------------------------------------
  // Checkbox changes
  // ------------------------------------------------------------------
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedSet.add(cb.value);
      } else {
        selectedSet.delete(cb.value);
      }
      renderChips();
      updateToggleLabel();
      onChange();
    });
  });

  // ------------------------------------------------------------------
  // "Clear" action
  // ------------------------------------------------------------------
  container
    .querySelector<HTMLButtonElement>('[data-action="clear"]')
    ?.addEventListener('click', () => {
      selectedSet.clear();
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
      renderChips();
      updateToggleLabel();
      onChange();
    });

  // ------------------------------------------------------------------
  // Chip rendering
  // ------------------------------------------------------------------
  function renderChips(): void {
    chipsContainer!.innerHTML = '';
    selectedSet.forEach(id => {
      const label = labelMap.get(id) ?? id;
      const chip = document.createElement('span');
      chip.className = `metric-chip ${chipClass}`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'metric-chip-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${label}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        selectedSet.delete(id);
        const cb = container?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(id)}"]`);
        if (cb) cb.checked = false;
        renderChips();
        updateToggleLabel();
        onChange();
      });

      chip.appendChild(labelSpan);
      chip.appendChild(removeBtn);
      chipsContainer!.appendChild(chip);
    });
  }

  function updateToggleLabel(): void {
    const count = selectedSet.size;
    toggle!.textContent = count === 0 ? placeholder : `${count} selected`;
  }

  // ------------------------------------------------------------------
  // Refresh disabled options (called when the other axis selection changes)
  // ------------------------------------------------------------------
  function refreshDisabled(): void {
    const disabled = getDisabled();
    container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
      const option = cb.closest<HTMLElement>('.multiselect-option');
      if (disabled.has(cb.value)) {
        cb.disabled = true;
        option?.classList.add('multiselect-option--disabled');
      } else {
        cb.disabled = false;
        option?.classList.remove('multiselect-option--disabled');
      }
    });
  }

  return refreshDisabled;
}

// ---------------------------------------------------------------------------
// Experiment overlay computation
// ---------------------------------------------------------------------------

const EXPERIMENT_OVERLAY_COLORS = [
  { bg: 'rgba(153, 102, 255, 0.15)', border: 'rgba(153, 102, 255, 0.5)' },
  { bg: 'rgba(255, 159, 64, 0.15)', border: 'rgba(255, 159, 64, 0.5)' },
  { bg: 'rgba(54, 162, 235, 0.15)', border: 'rgba(54, 162, 235, 0.5)' },
  { bg: 'rgba(255, 99, 132, 0.15)', border: 'rgba(255, 99, 132, 0.5)' },
  { bg: 'rgba(75, 192, 192, 0.15)', border: 'rgba(75, 192, 192, 0.5)' },
];

function dateObjectToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeExperimentOverlays(
  experimentIds: Set<string>,
  experiments: ExperimentOption[],
  startIso: string,
  endIso: string
): ExperimentOverlayInfo[] {
  if (!startIso || !endIso) return [];

  const overlays: ExperimentOverlayInfo[] = [];
  let colorIndex = 0;

  for (const id of experimentIds) {
    const exp = experiments.find(e => e.id === id);
    if (!exp || !exp.startDate) continue;

    const startDateObj = parseDataDate(exp.startDate);
    const endDateObj =
      exp.expectedDurationInWeeks != null
        ? new Date(startDateObj.getTime() + exp.expectedDurationInWeeks * 7 * 24 * 60 * 60 * 1000)
        : startDateObj;

    const expStartIso = dateObjectToIso(startDateObj);
    const expEndIso = dateObjectToIso(endDateObj);

    // Skip overlay if entirely outside the visible date range
    if (expEndIso < startIso || expStartIso > endIso) continue;

    const color = EXPERIMENT_OVERLAY_COLORS[colorIndex % EXPERIMENT_OVERLAY_COLORS.length];
    colorIndex++;

    overlays.push({
      id: exp.id,
      title: exp.title,
      startDate: expStartIso,
      endDate: expEndIso,
      color: color.bg,
      borderColor: color.border,
    });
  }

  return overlays;
}

// ---------------------------------------------------------------------------
// Chart update logic
// ---------------------------------------------------------------------------

function showMessage(message: string): void {
  const el = document.getElementById('chart-message');
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function hideMessage(): void {
  const el = document.getElementById('chart-message');
  if (el) {
    el.style.display = 'none';
  }
}

function buildAxisConfig(
  state: InsightsState,
  metricOptions: MetricOptionInfo[],
  startIso: string,
  endIso: string
): AxisConfig {
  const getLabelForId = (id: string) => metricOptions.find(o => o.id === id)?.label ?? id;

  const leftIds = Array.from(state.leftAxisIds);
  const rightIds = Array.from(state.rightAxisIds);

  const leftAxisLabel =
    leftIds.length === 1 ? getLabelForId(leftIds[0]) : leftIds.length > 1 ? 'Left Axis' : '';

  const rightAxisLabel =
    rightIds.length === 1
      ? getLabelForId(rightIds[0])
      : rightIds.length > 1
        ? 'Right Axis'
        : undefined;

  // An axis uses the fixed [0,4] capability range only when ALL its metrics are capability
  const leftAxisIsCapability = leftIds.length > 0 && leftIds.every(id => !id.includes(':'));
  const rightAxisIsCapability = rightIds.length > 0 && rightIds.every(id => !id.includes(':'));

  return {
    leftAxisLabel,
    rightAxisLabel,
    leftAxisIsCapability,
    rightAxisIsCapability,
    hasRightAxis: rightIds.length > 0,
    dateRange: startIso && endIso ? { start: startIso, end: endIso } : undefined,
  };
}

function buildChartTitle(state: InsightsState, metricOptions: MetricOptionInfo[]): string {
  const getLabelForId = (id: string) => metricOptions.find(o => o.id === id)?.label ?? id;

  const leftLabels = Array.from(state.leftAxisIds).map(getLabelForId);
  const rightLabels = Array.from(state.rightAxisIds).map(getLabelForId);

  const leftTitle = leftLabels.join(' · ');
  const rightTitle = rightLabels.join(' · ');

  if (leftTitle && rightTitle) {
    const combined = `${leftTitle} vs ${rightTitle}`;
    return combined.length <= 80 ? combined : 'Multi-Axis Comparison';
  }
  if (leftTitle) return leftTitle.length <= 80 ? leftTitle : 'Multiple Left Axis Metrics';
  return rightTitle.length <= 80 ? rightTitle : 'Multiple Right Axis Metrics';
}

/**
 * Extend the chart's label range to cover the full selected date span.
 * If the first data point is after startDate, the start date is prepended as a
 * label with null values on every dataset.  The same logic applies to endDate
 * on the right edge.  This keeps the x-axis visually anchored to the user's
 * chosen date range even when data starts or ends mid-range.
 */
function padChartDataToDateRange(
  chartData: ChartData,
  startDate: string,
  endDate: string
): ChartData {
  if (!startDate || !endDate || chartData.labels.length === 0) return chartData;

  const startMs = parseDataDate(startDate).getTime();
  const endMs = parseDataDate(endDate).getTime();
  const startIso = dataDateToInputDate(startDate);
  const endIso = dataDateToInputDate(endDate);

  let { labels, datasets } = chartData;

  if (new Date(labels[0]).getTime() > startMs) {
    labels = [startIso, ...labels];
    datasets = datasets.map(ds => ({
      ...ds,
      data: [null, ...ds.data],
      metadata: ds.metadata ? [undefined, ...ds.metadata] : undefined,
    }));
  }

  if (new Date(labels[labels.length - 1]).getTime() < endMs) {
    labels = [...labels, endIso];
    datasets = datasets.map(ds => ({
      ...ds,
      data: [...ds.data, null],
      metadata: ds.metadata ? [...ds.metadata, undefined] : undefined,
    }));
  }

  return { ...chartData, labels, datasets };
}

function createUpdateHandler(
  chartManager: ChartManager,
  state: InsightsState,
  appData: AppData,
  startDateInput: HTMLInputElement,
  endDateInput: HTMLInputElement
) {
  return function updateChart(): void {
    const startDate = inputDateToDataDate(startDateInput.value);
    const endDate = inputDateToDataDate(endDateInput.value);

    // Build chart data for each axis
    const leftData: ChartData[] = [];
    for (const id of state.leftAxisIds) {
      const label = appData.metricOptions.find(o => o.id === id)?.label;
      const data = getMetricChartData(
        id,
        appData.capabilityMetrics,
        appData.teamMetrics,
        appData.teams,
        startDate,
        endDate,
        label
      );
      if (data) leftData.push(data);
    }

    const rightData: ChartData[] = [];
    for (const id of state.rightAxisIds) {
      const label = appData.metricOptions.find(o => o.id === id)?.label;
      const data = getMetricChartData(
        id,
        appData.capabilityMetrics,
        appData.teamMetrics,
        appData.teams,
        startDate,
        endDate,
        label
      );
      if (data) rightData.push(data);
    }

    const rawChartData = buildMultiAxisChartData(leftData, rightData);

    if (!rawChartData) {
      showMessage('Select metrics for the left or right axis to view data');
      chartManager.destroy();
      return;
    }

    const chartData = padChartDataToDateRange(rawChartData, startDate, endDate);

    // Determine if this is a combo chart (one axis is qualitative / bar only)
    const leftIsLine =
      !leftData.some(d => d.qualitativeData) &&
      leftData.some(d => d.datasets.some(ds => ds.data.length > 1));
    const rightIsLine =
      !rightData.some(d => d.qualitativeData) &&
      rightData.some(d => d.datasets.some(ds => ds.data.length > 1));
    const anyIsLine = leftIsLine || rightIsLine;
    const allAreLines =
      (leftData.length === 0 || leftIsLine) && (rightData.length === 0 || rightIsLine);

    // Tag datasets for combo charts (line + bar)
    if (anyIsLine && !allAreLines) {
      const leftCount = leftData.reduce((n, d) => n + d.datasets.length, 0);
      chartData.datasets.forEach((ds, i) => {
        const isLeftSide = i < leftCount;
        if (isLeftSide ? leftIsLine : rightIsLine) {
          ds.type = 'line';
        }
      });
    }

    const chartTypeOverride = anyIsLine && !allAreLines ? 'bar' : undefined;

    const axisConfig = buildAxisConfig(
      state,
      appData.metricOptions,
      startDateInput.value,
      endDateInput.value
    );
    const title = buildChartTitle(state, appData.metricOptions);
    const experimentOverlays = computeExperimentOverlays(
      state.experimentIds,
      appData.experiments,
      startDateInput.value,
      endDateInput.value
    );

    hideMessage();
    chartManager.render(chartData, title, axisConfig, chartTypeOverride, experimentOverlays);
  };
}

// ---------------------------------------------------------------------------
// Date input initialisation
// ---------------------------------------------------------------------------

function initializeDateInputs(): void {
  const startDateInput = document.getElementById('start-date') as HTMLInputElement | null;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement | null;
  if (!startDateInput || !endDateInput) return;

  const startInitial = startDateInput.getAttribute('data-initial-value');
  const endInitial = endDateInput.getAttribute('data-initial-value');

  if (startInitial) startDateInput.value = dataDateToInputDate(startInitial);
  if (endInitial) endDateInput.value = dataDateToInputDate(endInitial);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

(function initializeInsights() {
  const canvas = document.getElementById('metrics-chart') as HTMLCanvasElement | null;
  const startDateInput = document.getElementById('start-date') as HTMLInputElement | null;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement | null;
  const zoomControls = document.getElementById('chart-zoom-controls') as HTMLElement | null;
  const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const resetZoomBtn = document.getElementById('reset-zoom') as HTMLButtonElement | null;

  if (!canvas || !startDateInput || !endDateInput) return;

  const appData = loadAppData();
  if (!appData) {
    showMessage('Error: metrics data not found');
    return;
  }

  initializeDateInputs();

  const state: InsightsState = {
    leftAxisIds: new Set(),
    rightAxisIds: new Set(),
    experimentIds: new Set(),
  };

  const chartManager = new ChartManager(canvas);
  const updateChart = createUpdateHandler(
    chartManager,
    state,
    appData,
    startDateInput,
    endDateInput
  );

  // Set up multi-selects with mutual exclusion between left and right axes.
  // Each setup() returns a refreshDisabled() function the other side calls.
  let refreshRightDisabled: (() => void) | null = null;
  let refreshLeftDisabled: (() => void) | null = null;

  refreshLeftDisabled = setupMultiSelect(
    'left-axis-select',
    'left-axis-chips',
    'metric-chip--left',
    state.leftAxisIds,
    () => {
      refreshRightDisabled?.();
      updateChart();
      if (zoomControls) zoomControls.style.display = chartManager.isRendered() ? 'flex' : 'none';
    },
    () => state.rightAxisIds
  );

  refreshRightDisabled = setupMultiSelect(
    'right-axis-select',
    'right-axis-chips',
    'metric-chip--right',
    state.rightAxisIds,
    () => {
      refreshLeftDisabled?.();
      updateChart();
      if (zoomControls) zoomControls.style.display = chartManager.isRendered() ? 'flex' : 'none';
    },
    () => state.leftAxisIds
  );

  setupMultiSelect(
    'experiment-select',
    'experiment-chips',
    'metric-chip--experiment',
    state.experimentIds,
    () => {
      updateChart();
      if (zoomControls) zoomControls.style.display = chartManager.isRendered() ? 'flex' : 'none';
    },
    () => new Set()
  );

  startDateInput.addEventListener('change', updateChart);
  endDateInput.addEventListener('change', updateChart);

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => chartManager.zoomIn());
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => chartManager.zoomOut());
  if (resetZoomBtn) resetZoomBtn.addEventListener('click', () => chartManager.resetZoom());

  window.addEventListener('beforeunload', () => chartManager.destroy());
})();
