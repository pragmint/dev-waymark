// Main orchestration for insights page

import { ChartManager } from './insights-chart';
import {
  transformTeamMetricData,
  transformCapabilityMetricData,
  type CapabilityMetric,
  type TeamMetric,
  type TeamInfo,
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
  startDate: HTMLInputElement;
  endDate: HTMLInputElement;
}

/**
 * Get form input elements
 */
function getFormInputs(): FormInputs | null {
  const metricSelect = document.getElementById('metric-select') as HTMLSelectElement;
  const startDate = document.getElementById('start-date') as HTMLInputElement;
  const endDate = document.getElementById('end-date') as HTMLInputElement;

  if (!metricSelect || !startDate || !endDate) {
    return null;
  }

  return { metricSelect, startDate, endDate };
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
 * Handle team-specific metric chart update
 */
function handleTeamMetric(
  metricId: string,
  teamMetrics: TeamMetric[],
  teams: TeamInfo[],
  inputs: FormInputs,
  chartManager: ChartManager
): void {
  const [teamId, metricName] = metricId.split(':');
  const metric = teamMetrics.find(m => m.teamId === teamId && m.metricName === metricName);

  if (!metric || metric.data.length === 0) {
    showMessage('No data available for this metric');
    chartManager.destroy();
    return;
  }

  // Convert HTML5 date format to data format
  const startDate = inputDateToDataDate(inputs.startDate.value);
  const endDate = inputDateToDataDate(inputs.endDate.value);

  const chartData = transformTeamMetricData(metric, startDate, endDate, teams);
  const title = inputs.metricSelect.options[inputs.metricSelect.selectedIndex].text;

  hideMessage();
  chartManager.render(chartData, title);
}

/**
 * Handle capability metric chart update
 */
function handleCapabilityMetric(
  metricId: string,
  capabilityMetrics: CapabilityMetric[],
  teams: TeamInfo[],
  inputs: FormInputs,
  chartManager: ChartManager
): void {
  const metric = capabilityMetrics.find(m => m.capabilityId === metricId);

  if (!metric || metric.data.length === 0) {
    showMessage('No data available for this capability');
    chartManager.destroy();
    return;
  }

  // Convert HTML5 date format to data format
  const startDate = inputDateToDataDate(inputs.startDate.value);
  const endDate = inputDateToDataDate(inputs.endDate.value);

  const chartData = transformCapabilityMetricData(metric, startDate, endDate, teams);

  if (!chartData) {
    showMessage('No data available for the selected filters');
    chartManager.destroy();
    return;
  }

  const title = inputs.metricSelect.options[inputs.metricSelect.selectedIndex].text;

  hideMessage();
  chartManager.render(chartData, title);
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

    const isTeamSpecific = selectedMetric.includes(':');

    if (isTeamSpecific) {
      handleTeamMetric(
        selectedMetric,
        metricsData.teamMetrics,
        metricsData.teams,
        inputs,
        chartManager
      );
    } else {
      handleCapabilityMetric(
        selectedMetric,
        metricsData.capabilityMetrics,
        metricsData.teams,
        inputs,
        chartManager
      );
    }
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
  const startDateInput = document.getElementById('start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement;

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

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    chartManager.destroy();
  });
})();
