// Mini chart initialization for experiment detail page

import type { ChartData, ChartConfiguration } from './chart-types';

export function resolveChartType(data: ChartData): 'line' | 'bar' {
  return data.datasets.some(ds => ds.data.length > 1) ? 'line' : 'bar';
}

if (typeof document !== 'undefined') {
  (function initializeMiniCharts() {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas.mini-chart-canvas');

    canvases.forEach(canvas => {
      const rawData = canvas.getAttribute('data-chart');
      if (!rawData) return;

      let data: ChartData;
      try {
        data = JSON.parse(rawData);
      } catch {
        return;
      }

      const chartType = resolveChartType(data);

      const config: ChartConfiguration = {
        type: chartType,
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            title: { display: false, text: '' },
          },
          scales: {
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 0,
              },
            },
            y: {
              beginAtZero: chartType === 'bar',
              grace: '10%',
            },
          },
        },
      };

      new window.Chart(canvas, config);
    });
  })();
}
