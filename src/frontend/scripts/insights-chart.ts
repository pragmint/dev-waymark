// Chart rendering and management

import type {
  ChartData,
  ChartDataset,
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
 * Qualitative (anecdote) metrics always use a bar chart.
 */
function resolveChartType(data: ChartData): 'line' | 'bar' {
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

type AxisRange = {
  y: { min: number; max: number } | null;
  y1: { min: number; max: number } | null;
};

type Range = { min: number; max: number };

function rangeFor(datasets: ChartDataset[]): Range | null {
  const values = datasets.flatMap(ds => ds.data).filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const padding = Math.max((dataMax - dataMin) * 0.1, 0.5);

  let min = dataMin - padding;
  let max = dataMax + padding;

  // Never let the lower bound go below 0
  min = Math.max(0, min);

  let currentRange = max - min;

  // Determine target range: multiple of 8, or 1/2/4/8 if smaller
  let targetRange: number;
  if (currentRange < 8) {
    // Find smallest value in [1, 2, 4, 8] that is >= currentRange
    if (currentRange <= 1) targetRange = 1;
    else if (currentRange <= 4) targetRange = 4;
    else targetRange = 8;
  } else {
    // Round up to next multiple of 8
    targetRange = Math.ceil(currentRange / 8) * 8;
  }

  // Round min down to integer
  min = Math.floor(min);

  // Set max to maintain target range (ensures max is also an integer)
  max = min + targetRange;

  return { min, max };
}

function computeAxisRanges(data: ChartData): AxisRange {
  const yDatasets = data.datasets.filter(ds => !ds.yAxisID || ds.yAxisID === 'y');
  const y1Datasets = data.datasets.filter(ds => ds.yAxisID === 'y1');

  return {
    y: rangeFor(yDatasets),
    y1: rangeFor(y1Datasets),
  };
}

const CAPABILITY_Y_RANGE = { min: 0, max: 4 };

export interface ComparisonConfig {
  metric1Label: string;
  metric2Label: string;
  metric1IsCapability?: boolean;
  metric2IsCapability?: boolean;
}

/**
 * Calculate aligned tick count for dual y-axes to ensure grid lines align.
 * Returns undefined if either range is null (no alignment needed).
 * Returns a value between 5 and 10 based on the larger of the two ranges.
 */
export function calculateAlignedTickCount(
  yRange: Range | null,
  y1Range: Range | null
): number | undefined {
  if (!yRange || !y1Range) {
    return undefined;
  }

  const yRangeSize = yRange.max - yRange.min;
  const y1RangeSize = y1Range.max - y1Range.min;

  // Estimate tick count based on range magnitude
  const estimateTickCount = (rangeSize: number): number => {
    // Use a logarithmic scale to determine tick density
    // Small ranges get more ticks, large ranges get fewer
    if (rangeSize <= 1) return 10;
    if (rangeSize <= 10) return 9;
    if (rangeSize <= 50) return 8;
    if (rangeSize <= 100) return 7;
    if (rangeSize <= 500) return 6;
    return 5;
  };

  const yTickCount = estimateTickCount(yRangeSize);
  const y1TickCount = estimateTickCount(y1RangeSize);

  // Return the maximum of the two estimates
  return Math.max(yTickCount, y1TickCount);
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
      const lines: string[] = [''];

      // For qualitative/anecdote data, show each entry separated by a blank line
      if (metadata.anecdotes) {
        const entries = String(metadata.anecdotes).split('\n\n');
        for (let i = 0; i < entries.length; i++) {
          if (i > 0) lines.push('');
          lines.push(entries[i]);
        }
        return lines;
      }

      // Format remaining metadata for display (numeric metrics with justifications etc.)
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

      return lines.length > 0 ? lines : '';
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
  render(
    data: ChartData,
    title: string,
    comparisonConfig?: ComparisonConfig,
    isCapabilityMetric?: boolean,
    chartTypeOverride?: 'line' | 'bar',
    leftAxisTitle?: string
  ): void {
    this.destroy();

    const limits = computeLimits(data);
    const chartType = chartTypeOverride ?? resolveChartType(data);
    // Only use annotation boxes for old-style qualitative data that has no numeric datasets
    const annotations =
      data.qualitativeData && data.datasets.length === 0
        ? createAnnotationsForQualitativeData(data)
        : undefined;
    const axisRanges = computeAxisRanges(data);

    const yIsCapability = comparisonConfig?.metric1IsCapability ?? isCapabilityMetric ?? false;
    const y1IsCapability = comparisonConfig?.metric2IsCapability ?? false;
    const yRange = yIsCapability ? CAPABILITY_Y_RANGE : axisRanges.y;
    const y1Range = y1IsCapability ? CAPABILITY_Y_RANGE : axisRanges.y1;

    // Calculate aligned tick count when comparing metrics
    const alignedTickCount = comparisonConfig
      ? calculateAlignedTickCount(yRange, y1Range)
      : undefined;

    const config: ChartConfiguration = {
      type: chartType,
      data,
      options: {
        spanGaps: true,
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
              mode: 'x',
            },
            pan: {
              enabled: true,
              mode: 'x',
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
            ...(yRange ? { min: yRange.min, max: yRange.max } : { grace: '10%' }),
            position: 'left',
            title: comparisonConfig
              ? {
                  display: true,
                  text: comparisonConfig.metric1Label,
                }
              : leftAxisTitle
                ? { display: true, text: leftAxisTitle }
                : undefined,
            ...(alignedTickCount ? { ticks: { count: alignedTickCount } } : {}),
          },
        },
      },
    };

    // Add annotations if we have qualitative data without stacking
    if (annotations) {
      config.options.plugins.annotation = annotations;
    }

    // Add second y-axis if comparing metrics
    if (comparisonConfig) {
      config.options.scales.y1 = {
        beginAtZero: chartType === 'bar',
        ...(y1Range ? { min: y1Range.min, max: y1Range.max } : { grace: '10%' }),
        position: 'right',
        title: {
          display: true,
          text: comparisonConfig.metric2Label,
        },
        ...(alignedTickCount ? { ticks: { count: alignedTickCount } } : {}),
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
