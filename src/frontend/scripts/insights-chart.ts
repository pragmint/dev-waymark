// Chart rendering and management

import type { ChartData, ChartInstance, ChartConfiguration, ZoomAxisLimits } from './chart-types';

/**
 * Resolve chart type based on data density.
 * Uses 'bar' when every dataset has a single data point (e.g. a snapshot in
 * time), and 'line' as soon as any dataset has more than one point.
 */
function resolveChartType(data: ChartData): 'line' | 'bar' {
  return data.datasets.some(ds => ds.data.length > 1) ? 'line' : 'bar';
}

/**
 * Derive zoom/pan limits from the rendered data so the user cannot pan or
 * zoom beyond the actual data range on either axis.
 *
 * Y-axis: bounded by [min - padding, max + padding] with a minimum padding of
 * 0.5 to avoid collapsing the range on flat data.
 * X-axis: bounded by the label indices [0, length-1]; minRange prevents
 * zooming in to fewer than 3 visible points (or all points if fewer than 3).
 */
function computeLimits(data: ChartData): { x: ZoomAxisLimits; y: ZoomAxisLimits } {
  const allValues = data.datasets.flatMap(ds => ds.data).filter((v): v is number => v !== null);

  const yMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const yMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const yPadding = Math.max((yMax - yMin) * 0.1, 0.5);

  return {
    x: {
      min: 0,
      max: data.labels.length - 1,
      minRange: Math.min(2, data.labels.length - 1),
    },
    y: {
      min: yMin - yPadding,
      max: yMax + yPadding,
      minRange: yPadding * 2,
    },
  };
}

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

    const limits = computeLimits(data);
    const chartType = resolveChartType(data);

    const config: ChartConfiguration = {
      type: chartType,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: true,
            text: title,
          },
          zoom: {
            limits,
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'xy',
            },
            pan: {
              enabled: true,
              mode: 'xy',
            },
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
            beginAtZero: chartType === 'bar',
            grace: '10%',
          },
        },
      },
    };

    this.chart = new window.Chart(this.canvas, config);
  }

  /**
   * Reset zoom to original view
   */
  resetZoom(): void {
    if (this.chart) {
      this.chart.resetZoom();
    }
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
