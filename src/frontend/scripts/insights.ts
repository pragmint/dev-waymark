// Main orchestration for insights page

import { ChartManager, type ComparisonConfig } from './insights-chart';
import { dataDateToInputDate, inputDateToDataDate } from './insights-date-utils';
import {
  transformCapabilityMetricData,
  transformTeamMetricData,
  mergeChartDataForComparison,
  type ChartData,
} from './insights-data';
import {
  findMetric,
  getMetricLabel,
  isCapabilityMetric,
  type MetricsData,
} from './insights-metric-utils';

/**
 * Get current URL search params
 */
function getUrlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Get selected metric ID from query parameter
 */
function getSelectedMetric(queryKey: string): string | null {
  const params = getUrlParams();
  const value = params.get(queryKey);
  return value && value.length > 0 ? value : null;
}

/**
 * Load metrics data from embedded script tag
 */
function loadMetricsData(): MetricsData | null {
  const dataScript = document.getElementById('metrics-data');
  if (!dataScript?.textContent) {
    return null;
  }

  try {
    return JSON.parse(dataScript.textContent) as MetricsData;
  } catch (e) {
    console.error('Failed to parse metrics data:', e);
    return null;
  }
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
 * Update chart based on current selections
 */
function updateChart(
  chartManager: ChartManager,
  metricsData: MetricsData,
  startDateInput: HTMLInputElement,
  endDateInput: HTMLInputElement,
  chartMessage: HTMLElement
): void {
  const leftMetricId = getSelectedMetric('left');
  const rightMetricId = getSelectedMetric('right');

  // Get date range
  const startDate = startDateInput.value ? inputDateToDataDate(startDateInput.value) : null;
  const endDate = endDateInput.value ? inputDateToDataDate(endDateInput.value) : null;

  if (!startDate || !endDate) {
    chartMessage.textContent = 'Please select a date range';
    chartMessage.style.display = 'block';
    chartManager.destroy();
    return;
  }

  // No metrics selected
  if (!leftMetricId && !rightMetricId) {
    chartMessage.textContent = 'Select a metric to display the chart';
    chartMessage.style.display = 'block';
    chartManager.destroy();
    return;
  }

  let chartData: ChartData | null = null;
  let chartTitle = '';
  let comparisonConfig: ComparisonConfig | undefined = undefined;
  let isCapability = false;

  // Both metrics selected - comparison mode
  if (leftMetricId && rightMetricId) {
    const leftMetric = findMetric(leftMetricId, metricsData);
    const rightMetric = findMetric(rightMetricId, metricsData);

    if (!leftMetric || !rightMetric) {
      chartMessage.textContent = 'Selected metric not found';
      chartMessage.style.display = 'block';
      chartManager.destroy();
      return;
    }

    // Transform both metrics
    let leftData: ChartData | null = null;
    let rightData: ChartData | null = null;

    if (leftMetric.type === 'capability') {
      leftData = transformCapabilityMetricData(
        leftMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    } else {
      leftData = transformTeamMetricData(leftMetric.metric, startDate, endDate, metricsData.teams);
    }

    if (rightMetric.type === 'capability') {
      rightData = transformCapabilityMetricData(
        rightMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    } else {
      rightData = transformTeamMetricData(
        rightMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    }

    if (!leftData || !rightData) {
      chartMessage.textContent = 'No data available for the selected date range';
      chartMessage.style.display = 'block';
      chartManager.destroy();
      return;
    }

    chartData = mergeChartDataForComparison(leftData, rightData);
    chartTitle = 'Metric Comparison';
    comparisonConfig = {
      metric1Label: getMetricLabel(leftMetricId, metricsData.metricOptions),
      metric2Label: getMetricLabel(rightMetricId, metricsData.metricOptions),
      metric1IsCapability: isCapabilityMetric(leftMetricId),
      metric2IsCapability: isCapabilityMetric(rightMetricId),
    };
  }
  // Only left metric selected
  else if (leftMetricId) {
    const leftMetric = findMetric(leftMetricId, metricsData);

    if (!leftMetric) {
      chartMessage.textContent = 'Selected metric not found';
      chartMessage.style.display = 'block';
      chartManager.destroy();
      return;
    }

    if (leftMetric.type === 'capability') {
      chartData = transformCapabilityMetricData(
        leftMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    } else {
      chartData = transformTeamMetricData(leftMetric.metric, startDate, endDate, metricsData.teams);
    }

    chartTitle = getMetricLabel(leftMetricId, metricsData.metricOptions);
    isCapability = isCapabilityMetric(leftMetricId);
  }
  // Only right metric selected
  else if (rightMetricId) {
    const rightMetric = findMetric(rightMetricId, metricsData);

    if (!rightMetric) {
      chartMessage.textContent = 'Selected metric not found';
      chartMessage.style.display = 'block';
      chartManager.destroy();
      return;
    }

    if (rightMetric.type === 'capability') {
      chartData = transformCapabilityMetricData(
        rightMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    } else {
      chartData = transformTeamMetricData(
        rightMetric.metric,
        startDate,
        endDate,
        metricsData.teams
      );
    }

    chartTitle = getMetricLabel(rightMetricId, metricsData.metricOptions);
    isCapability = isCapabilityMetric(rightMetricId);
  }

  if (!chartData) {
    chartMessage.textContent = 'No data available for the selected date range';
    chartMessage.style.display = 'block';
    chartManager.destroy();
    return;
  }

  // Hide message and render chart
  chartMessage.style.display = 'none';
  chartManager.render(chartData, chartTitle, comparisonConfig, isCapability);
}

/**
 * Initialize insights page
 */
(function initializeInsights() {
  // Guard against execution in non-browser environments (e.g., test runner)
  if (typeof document === 'undefined') {
    return;
  }
  const canvas = document.getElementById('metrics-chart') as HTMLCanvasElement;
  const startDateInput = document.getElementById('start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement;
  const chartMessage = document.getElementById('chart-message') as HTMLElement;
  const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const resetZoomBtn = document.getElementById('reset-zoom') as HTMLButtonElement | null;

  if (!canvas || !startDateInput || !endDateInput || !chartMessage) {
    return;
  }

  // Load metrics data
  const metricsData = loadMetricsData();
  if (!metricsData) {
    chartMessage.textContent = 'Failed to load metrics data';
    chartMessage.style.display = 'block';
    return;
  }

  // Initialize date inputs
  initializeDateInputs();

  const chartManager = new ChartManager(canvas);

  // Wire up zoom buttons
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => chartManager.zoomIn());
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => chartManager.zoomOut());
  }
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', () => chartManager.resetZoom());
  }

  // Initial chart render
  updateChart(chartManager, metricsData, startDateInput, endDateInput, chartMessage);

  // Listen for date changes
  startDateInput.addEventListener('change', () => {
    updateChart(chartManager, metricsData, startDateInput, endDateInput, chartMessage);
  });
  endDateInput.addEventListener('change', () => {
    updateChart(chartManager, metricsData, startDateInput, endDateInput, chartMessage);
  });

  // Listen for URL changes (from chip selector and browser back/forward)
  window.addEventListener('urlchange', () => {
    updateChart(chartManager, metricsData, startDateInput, endDateInput, chartMessage);
  });
  window.addEventListener('popstate', () => {
    updateChart(chartManager, metricsData, startDateInput, endDateInput, chartMessage);
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    chartManager.destroy();
  });
})();
