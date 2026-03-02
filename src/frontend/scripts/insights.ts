// Main orchestration for insights page

import { ChartManager } from './insights-chart';
import { dataDateToInputDate } from './insights-date-utils';

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
  const startDateInput = document.getElementById('start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('end-date') as HTMLInputElement;
  const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const resetZoomBtn = document.getElementById('reset-zoom') as HTMLButtonElement | null;

  if (!canvas || !startDateInput || !endDateInput) {
    return;
  }

  // Initialize date inputs
  initializeDateInputs();

  const chartManager = new ChartManager(canvas);

  // Wire up zoom buttons (will be functional when chart is implemented)
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
