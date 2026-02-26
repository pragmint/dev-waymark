// Chart rendering and management

import type {
  ChartData,
  ChartInstance,
  ChartConfiguration,
  ZoomAxisLimits,
  AnnotationPluginOptions,
  TooltipContext,
} from './chart-types';
import { formatDataDateForDisplay } from './insights-date-utils';

/**
 * Resolve chart type based on data density.
 * Uses 'bar' when every dataset has a single data point (e.g. a snapshot in
 * time), and 'line' as soon as any dataset has more than one point.
 */
function resolveChartType(data: ChartData): 'line' | 'bar' {
  // For qualitative metrics, use bar chart (empty datasets will just show annotations)
  if (data.qualitativeData) {
    return 'bar';
  }
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
  // For qualitative data, use default y-axis limits
  if (data.qualitativeData) {
    return {
      x: {
        min: 0,
        max: data.labels.length - 1,
        minRange: Math.min(2, data.labels.length - 1),
      },
      y: {
        min: 0,
        max: 1,
        minRange: 1,
      },
    };
  }

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

export interface ComparisonConfig {
  metric1Label: string;
  metric2Label: string;
}

/**
 * Create annotations for qualitative data points
 * Each annotation is a box spanning the full y-axis at the appropriate x position
 */
function createAnnotationsForQualitativeData(data: ChartData): AnnotationPluginOptions | undefined {
  if (!data.qualitativeData || data.qualitativeData.length === 0) {
    return undefined;
  }

  const annotations: AnnotationPluginOptions['annotations'] = {};
  // Store mousemove listeners so we can properly remove them
  const tooltipListeners = new Map<string, (e: MouseEvent) => void>();

  data.qualitativeData.forEach((point, index) => {
    const labelIndex = data.labels.findIndex(
      label => label === formatDataDateForDisplay(point.date)
    );

    if (labelIndex >= 0) {
      // Create a tooltip div that will be shown on hover
      const tooltipId = `qualitative-tooltip-${index}`;

      annotations[`qualitative-${index}`] = {
        type: 'box',
        xMin: labelIndex - 0.3,
        xMax: labelIndex + 0.3,
        yMin: 'min',
        yMax: 'max',
        backgroundColor: 'rgba(255, 206, 86, 0.1)',
        borderColor: 'rgba(255, 206, 86, 0.5)',
        borderWidth: 2,
        label: {
          display: false,
          content: point.value,
        },
        enter: () => {
          // Clean up any existing tooltip and listener first
          const existingTooltip = document.getElementById(tooltipId);
          if (existingTooltip) {
            existingTooltip.remove();
          }
          const existingListener = tooltipListeners.get(tooltipId);
          if (existingListener) {
            document.removeEventListener('mousemove', existingListener);
            tooltipListeners.delete(tooltipId);
          }

          // Create tooltip
          const tooltip = document.createElement('div');
          tooltip.id = tooltipId;
          tooltip.style.position = 'fixed';
          tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
          tooltip.style.color = 'white';
          tooltip.style.padding = '10px';
          tooltip.style.borderRadius = '4px';
          tooltip.style.maxWidth = '400px';
          tooltip.style.zIndex = '10000';
          tooltip.style.pointerEvents = 'none';
          tooltip.style.whiteSpace = 'pre-wrap';
          tooltip.style.overflowWrap = 'break-word';

          let content = `Date: ${formatDataDateForDisplay(point.date)}\n\n${point.value}`;

          // Add metadata if present
          if (point.metadata) {
            content += '\n\n';
            for (const [key, value] of Object.entries(point.metadata)) {
              content += `${key}: ${value}\n`;
            }
          }

          tooltip.textContent = content;
          document.body.appendChild(tooltip);

          // Create and store the mousemove listener
          const updateTooltipPosition = (e: MouseEvent) => {
            tooltip.style.left = `${e.clientX + 10}px`;
            tooltip.style.top = `${e.clientY + 10}px`;
          };

          tooltipListeners.set(tooltipId, updateTooltipPosition);
          document.addEventListener('mousemove', updateTooltipPosition);
        },
        leave: () => {
          // Remove tooltip from DOM
          const tooltip = document.getElementById(tooltipId);
          if (tooltip) {
            tooltip.remove();
          }

          // Remove the mousemove listener using the stored reference
          const listener = tooltipListeners.get(tooltipId);
          if (listener) {
            document.removeEventListener('mousemove', listener);
            tooltipListeners.delete(tooltipId);
          }
        },
      };
    }
  });

  return { annotations };
}

/**
 * Create tooltip callbacks to display metadata
 */
function createTooltipCallbacks() {
  return {
    afterBody: (context: TooltipContext[]) => {
      if (context.length === 0) return '';

      const ctx = context[0];
      const dataset = ctx.dataset;
      const dataIndex = ctx.dataIndex;

      // Check if this dataset has metadata
      if (!dataset.metadata || !dataset.metadata[dataIndex]) {
        return '';
      }

      const metadata = dataset.metadata[dataIndex];
      const lines: string[] = [];

      // Format metadata for display
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null && value !== '') {
          // Format key: convert snake_case to Title Case
          const formattedKey = key
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          // Handle long values (like justifications)
          const valueStr = String(value);
          if (valueStr.length > 100) {
            // Wrap long text
            const wrapped = valueStr.match(/.{1,80}(\s|$)/g) || [valueStr];
            lines.push(`${formattedKey}:`);
            wrapped.forEach(line => lines.push(`  ${line.trim()}`));
          } else {
            lines.push(`${formattedKey}: ${valueStr}`);
          }
        }
      }

      return lines.length > 0 ? ['\n', ...lines] : '';
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
  render(data: ChartData, title: string, comparisonConfig?: ComparisonConfig): void {
    this.destroy();

    const limits = computeLimits(data);
    const chartType = resolveChartType(data);
    const annotations = createAnnotationsForQualitativeData(data);

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
              wheel: { enabled: false },
              pinch: { enabled: false },
              mode: 'xy',
            },
            pan: {
              enabled: true,
              mode: 'xy',
            },
          },
          tooltip: {
            callbacks: createTooltipCallbacks(),
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
            position: 'left',
            title: comparisonConfig
              ? {
                  display: true,
                  text: comparisonConfig.metric1Label,
                }
              : undefined,
          },
        },
      },
    };

    // Add annotations if we have qualitative data
    if (annotations) {
      config.options.plugins.annotation = annotations;
    }

    // Add second y-axis if comparing metrics
    if (comparisonConfig) {
      config.options.scales.y1 = {
        beginAtZero: chartType === 'bar',
        grace: '10%',
        position: 'right',
        title: {
          display: true,
          text: comparisonConfig.metric2Label,
        },
      };
    }

    this.chart = new window.Chart(this.canvas, config);
  }

  /**
   * Zoom in by 20%
   */
  zoomIn(): void {
    if (this.chart) {
      this.chart.zoom(1.2);
    }
  }

  /**
   * Zoom out by ~17% (inverse of zoom in)
   */
  zoomOut(): void {
    if (this.chart) {
      this.chart.zoom(1 / 1.2);
    }
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
