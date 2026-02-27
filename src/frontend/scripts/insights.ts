// Main orchestration for insights page

import { ChartManager, type ComparisonConfig } from './insights-chart';
import {
  transformTeamMetricData,
  transformCapabilityMetricData,
  mergeChartDataForComparison,
  type CapabilityMetric,
  type TeamMetric,
  type TeamInfo,
  type ChartData,
} from './insights-data';
import { dataDateToInputDate, inputDateToDataDate } from './insights-date-utils';

interface MetricsData {
  capabilityMetrics: string;
  teamMetrics: string;
  availableDates: string[];
  teams: TeamInfo[];
}

interface FormInputs {
  metricSelect: HTMLSelectElement;
  compareMetricSelect: HTMLSelectElement | null;
  startDate: HTMLInputElement;
  endDate: HTMLInputElement;
}

/**
 * Get form input elements
 */
function getFormInputs(): FormInputs | null {
  const metricSelect = document.getElementById('metric-select') as HTMLSelectElement;
  const compareMetricSelect = document.getElementById(
    'compare-metric-select'
  ) as HTMLSelectElement | null;
  const startDate = document.getElementById('start-date') as HTMLInputElement;
  const endDate = document.getElementById('end-date') as HTMLInputElement;

  if (!metricSelect || !startDate || !endDate) {
    return null;
  }

  return { metricSelect, compareMetricSelect, startDate, endDate };
}

/**
 * Load metrics data from embedded script tag
 */
function loadMetricsData(): {
  capabilityMetrics: CapabilityMetric[];
  teamMetrics: TeamMetric[];
  teams: TeamInfo[];
} | null {
  const dataElement = document.getElementById('metrics-data');
  if (!dataElement || !dataElement.textContent) {
    return null;
  }

  try {
    const metricsData: MetricsData = JSON.parse(dataElement.textContent);
    return {
      capabilityMetrics: JSON.parse(metricsData.capabilityMetrics),
      teamMetrics: JSON.parse(metricsData.teamMetrics),
      teams: metricsData.teams,
    };
  } catch {
    return null;
  }
}

/**
 * Show error message to user
 */
function showMessage(message: string): void {
  const messageDiv = document.getElementById('chart-message') as HTMLDivElement;
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.style.display = 'block';
  }
}

/**
 * Hide message
 */
function hideMessage(): void {
  const messageDiv = document.getElementById('chart-message') as HTMLDivElement;
  if (messageDiv) {
    messageDiv.style.display = 'none';
  }
}

/**
 * Get chart data for a single metric
 */
function getMetricChartData(
  metricId: string,
  capabilityMetrics: CapabilityMetric[],
  teamMetrics: TeamMetric[],
  teams: TeamInfo[],
  startDate: string,
  endDate: string,
  metricName?: string
): ChartData | null {
  const isTeamSpecific = metricId.includes(':');

  if (isTeamSpecific) {
    const [teamId, teamMetricName] = metricId.split(':');
    const metric = teamMetrics.find(m => m.teamId === teamId && m.metricName === teamMetricName);

    if (!metric || metric.data.length === 0) {
      return null;
    }

    return transformTeamMetricData(metric, startDate, endDate, teams);
  } else {
    const metric = capabilityMetrics.find(m => m.capabilityId === metricId);

    if (!metric || metric.data.length === 0) {
      return null;
    }

    return transformCapabilityMetricData(metric, startDate, endDate, teams, metricName);
  }
}

/**
 * Get metric label from select element
 */
function getMetricLabel(selectElement: HTMLSelectElement): string {
  return selectElement.options[selectElement.selectedIndex]?.text || '';
}

/**
 * Check if chart data represents a time-series (line) metric.
 * Qualitative/anecdote metrics always render as bars even when they have multiple data points.
 */
function isLineSeries(data: ChartData): boolean {
  return !data.qualitativeData && data.datasets.some(ds => ds.data.length > 1);
}

/**
 * Main update chart handler
 */
function createUpdateHandler(chartManager: ChartManager) {
  return function updateChart(): void {
    const inputs = getFormInputs();
    if (!inputs) {
      showMessage('Error: Form inputs not found');
      return;
    }

    const selectedMetric = inputs.metricSelect.value;
    if (!selectedMetric) {
      showMessage('Please select a metric');
      chartManager.destroy();
      return;
    }

    const metricsData = loadMetricsData();
    if (!metricsData) {
      showMessage('Error: Metrics data not found');
      return;
    }

    // Convert HTML5 date format to data format
    const startDate = inputDateToDataDate(inputs.startDate.value);
    const endDate = inputDateToDataDate(inputs.endDate.value);

    // Get primary metric data
    const primaryLabel = getMetricLabel(inputs.metricSelect);
    const primaryData = getMetricChartData(
      selectedMetric,
      metricsData.capabilityMetrics,
      metricsData.teamMetrics,
      metricsData.teams,
      startDate,
      endDate,
      primaryLabel
    );

    if (!primaryData) {
      showMessage('No data available for this metric');
      chartManager.destroy();
      return;
    }

    // Check if a comparison metric is selected
    const compareMetric = inputs.compareMetricSelect?.value;
    if (compareMetric) {
      const compareLabel = getMetricLabel(inputs.compareMetricSelect!);
      const compareData = getMetricChartData(
        compareMetric,
        metricsData.capabilityMetrics,
        metricsData.teamMetrics,
        metricsData.teams,
        startDate,
        endDate,
        compareLabel
      );

      if (compareData) {
        const mergedData = mergeChartDataForComparison(primaryData, compareData);

        if (mergedData) {
          const primaryIsLine = isLineSeries(primaryData);
          const compareIsLine = isLineSeries(compareData);

          // Combo (line + bar): tag the line datasets so Chart.js renders them as lines
          // while using 'bar' as the base chart type.
          if (primaryIsLine !== compareIsLine) {
            const splitIndex = primaryData.datasets.length;
            if (primaryIsLine) {
              mergedData.datasets.slice(0, splitIndex).forEach(ds => {
                ds.type = 'line';
              });
            } else {
              mergedData.datasets.slice(splitIndex).forEach(ds => {
                ds.type = 'line';
              });
            }
          }

          const title = `${primaryLabel} vs ${compareLabel}`;
          const comparisonConfig: ComparisonConfig = {
            metric1Label: primaryLabel,
            metric2Label: compareLabel,
            metric1IsCapability: !selectedMetric.includes(':'),
            metric2IsCapability: !compareMetric.includes(':'),
          };

          // Line+line keeps 'line' as chart type; everything else uses 'bar' as the base.
          const chartTypeOverride = !(primaryIsLine && compareIsLine) ? 'bar' : undefined;

          hideMessage();
          chartManager.render(mergedData, title, comparisonConfig, undefined, chartTypeOverride);
          return;
        }
      }
    }

    // Render single metric
    hideMessage();
    chartManager.render(primaryData, primaryLabel, undefined, !selectedMetric.includes(':'));
  };
}

/**
 * Initialize date inputs with values from data attributes
 */
function initializeDateInputs(): void {
  const startDateInput = document.getElementById('start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement;

  if (!startDateInput || !endDateInput) {
    return;
  }

  // Get initial values from data attributes (in dd.m.yyyy format)
  const startInitial = startDateInput.getAttribute('data-initial-value');
  const endInitial = endDateInput.getAttribute('data-initial-value');

  // Convert to HTML5 date format (yyyy-mm-dd) and set values
  if (startInitial) {
    startDateInput.value = dataDateToInputDate(startInitial);
  }
  if (endInitial) {
    endDateInput.value = dataDateToInputDate(endInitial);
  }
}

/**
 * Initialize insights page
 */
(function initializeInsights() {
  const canvas = document.getElementById('metrics-chart') as HTMLCanvasElement;
  const metricSelect = document.getElementById('metric-select') as HTMLSelectElement;
  const compareMetricSelect = document.getElementById(
    'compare-metric-select'
  ) as HTMLSelectElement | null;
  const startDateInput = document.getElementById('start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement;
  const zoomControls = document.getElementById('chart-zoom-controls') as HTMLElement | null;
  const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const resetZoomBtn = document.getElementById('reset-zoom') as HTMLButtonElement | null;

  if (!canvas || !metricSelect || !startDateInput || !endDateInput) {
    return;
  }

  // Initialize date inputs
  initializeDateInputs();

  const chartManager = new ChartManager(canvas);
  const updateChart = createUpdateHandler(chartManager);

  // Update chart automatically when any input changes
  metricSelect.addEventListener('change', updateChart);
  startDateInput.addEventListener('change', updateChart);
  endDateInput.addEventListener('change', updateChart);

  // Add listener for comparison metric select if it exists
  if (compareMetricSelect) {
    compareMetricSelect.addEventListener('change', updateChart);
  }

  // Show zoom controls once a chart is rendered; wire up buttons
  if (zoomControls) {
    metricSelect.addEventListener('change', () => {
      zoomControls.style.display = chartManager.isRendered() ? 'flex' : 'none';
    });
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => chartManager.zoomIn());
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => chartManager.zoomOut());
  }
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', () => chartManager.resetZoom());
  }

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    chartManager.destroy();
  });
})();
