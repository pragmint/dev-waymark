// Chart rendering and management

import type { ChartData, ChartInstance, ChartConfiguration } from './chart-types';

/**
 * Chart manager - handles chart lifecycle
 */
export class ChartManager {
  private chart: ChartInstance | null = null;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Render or update chart with new data
   */
  render(data: ChartData, title: string): void {
    this.destroy();

    const config: ChartConfiguration = {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: true,
            text: title,
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 90,
              minRotation: 45,
            },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    };

    this.chart = new window.Chart(this.canvas, config);
  }

  /**
   * Destroy current chart instance
   */
  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  /**
   * Check if chart is currently rendered
   */
  isRendered(): boolean {
    return this.chart !== null;
  }
}
