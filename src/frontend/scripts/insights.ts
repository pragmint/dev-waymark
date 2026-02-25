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
  endDate: string
): ChartData | null {
  const isTeamSpecific = metricId.includes(':');

  if (isTeamSpecific) {
    const [teamId, metricName] = metricId.split(':');
    const metric = teamMetrics.find(m => m.teamId === teamId && m.metricName === metricName);

    if (!metric || metric.data.length === 0) {
      return null;
    }

    return transformTeamMetricData(metric, startDate, endDate, teams);
  } else {
    const metric = capabilityMetrics.find(m => m.capabilityId === metricId);

    if (!metric || metric.data.length === 0) {
      return null;
    }

    return transformCapabilityMetricData(metric, startDate, endDate, teams);
  }
}

/**
 * Get metric label from select element
 */
function getMetricLabel(selectElement: HTMLSelectElement): string {
  return selectElement.options[selectElement.selectedIndex]?.text || '';
}

/**
 * Check if chart data represents a line chart with multiple values
 */
function isLineChartWithMultipleValues(data: ChartData | null): boolean {
  if (!data) return false;
  return data.datasets.some(ds => ds.data.length > 1);
}

/**
 * Update visibility of comparison dropdown
 */
function updateComparisonDropdownVisibility(
  primaryMetricData: ChartData | null,
  compareMetricGroup: HTMLElement | null
): void {
  if (!compareMetricGroup) return;

  if (isLineChartWithMultipleValues(primaryMetricData)) {
    compareMetricGroup.style.display = 'block';
  } else {
    compareMetricGroup.style.display = 'none';
    // Reset comparison selection when hiding
    const compareSelect = document.getElementById('compare-metric-select') as HTMLSelectElement;
    if (compareSelect) {
      compareSelect.value = '';
    }
  }
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
      // Hide comparison dropdown when no metric is selected
      const compareMetricGroup = document.getElementById('compare-metric-group');
      if (compareMetricGroup) {
        compareMetricGroup.style.display = 'none';
      }
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
    const primaryData = getMetricChartData(
      selectedMetric,
      metricsData.capabilityMetrics,
      metricsData.teamMetrics,
      metricsData.teams,
      startDate,
      endDate
    );

    if (!primaryData) {
      showMessage('No data available for this metric');
      chartManager.destroy();
      return;
    }

    // Update comparison dropdown visibility based on primary metric
    const compareMetricGroup = document.getElementById('compare-metric-group');
    updateComparisonDropdownVisibility(primaryData, compareMetricGroup);

    // Check if comparison is enabled
    const compareMetric = inputs.compareMetricSelect?.value;
    if (compareMetric && isLineChartWithMultipleValues(primaryData)) {
      // Get comparison metric data
      const compareData = getMetricChartData(
        compareMetric,
        metricsData.capabilityMetrics,
        metricsData.teamMetrics,
        metricsData.teams,
        startDate,
        endDate
      );

      // Only allow comparison if both are line charts
      if (compareData && isLineChartWithMultipleValues(compareData)) {
        const mergedData = mergeChartDataForComparison(primaryData, compareData);

        if (mergedData) {
          const primaryLabel = getMetricLabel(inputs.metricSelect);
          const compareLabel = getMetricLabel(inputs.compareMetricSelect!);
          const title = `${primaryLabel} vs ${compareLabel}`;
          const comparisonConfig: ComparisonConfig = {
            metric1Label: primaryLabel,
            metric2Label: compareLabel,
          };

          hideMessage();
          chartManager.render(mergedData, title, comparisonConfig);
          return;
        }
      }
    }

    // Render single metric
    const title = getMetricLabel(inputs.metricSelect);
    hideMessage();
    chartManager.render(primaryData, title);
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

  // Show reset zoom button once a chart is rendered; wire up click
  if (resetZoomBtn) {
    metricSelect.addEventListener('change', () => {
      resetZoomBtn.style.display = chartManager.isRendered() ? 'block' : 'none';
    });
    resetZoomBtn.addEventListener('click', () => {
      chartManager.resetZoom();
    });
  }

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    chartManager.destroy();
  });
})();
