import type {
  MeasureTransform,
  SmoothingConfig,
  VisualizationConfig,
} from '../schemas/visualization';
import type {
  TemplateConfig,
  DurationTrendSlots,
  CategoryBreakdownSlots,
  PhaseSnapshotSlots,
  ThroughputOverTimeSlots,
  FieldTrendSlots,
  CategoryComparisonSlots,
} from '../schemas/visualizationTemplate';

// Turns the optional unitDivisor/unitLabel slot pair into a MeasureTransform.
// A label is required to activate the transform; an invalid or missing divisor
// falls back to 1 (i.e. no scaling, just a relabel).
function resolveMeasureTransform(slots: {
  unitDivisor?: string;
  unitLabel?: string;
}): MeasureTransform | undefined {
  const unitLabel = slots.unitLabel?.trim();
  if (!unitLabel) return undefined;
  const divisor = Number(slots.unitDivisor);
  return { divisor: divisor > 0 ? divisor : 1, unitLabel };
}

// Turns the optional smoothingWindow slot into a SmoothingConfig. The window
// size alone activates the feature — an unset, blank, or invalid (< 2) value
// leaves smoothing off rather than falling back to some default window.
function resolveSmoothing(slots: { smoothingWindow?: string }): SmoothingConfig | undefined {
  if (!slots.smoothingWindow?.trim()) return undefined;
  const windowSize = Number(slots.smoothingWindow);
  if (!Number.isInteger(windowSize) || windowSize < 2) return undefined;
  return { windowSize };
}

/**
 * Converts a template selection + filled slots into a VisualizationConfig
 * that the existing chartDataBuilder can process.
 */
export function resolveTemplate(template: TemplateConfig): VisualizationConfig {
  switch (template.templateId) {
    case 'duration_trend':
      return resolveDurationTrend(template.slots);
    case 'category_breakdown':
      return resolveCategoryBreakdown(template.slots);
    case 'phase_snapshot':
      return resolvePhaseSnapshot(template.slots);
    case 'throughput_over_time':
      return resolveThroughputOverTime(template.slots);
    case 'field_trend':
      return resolveFieldTrend(template.slots);
    case 'category_comparison':
      return resolveCategoryComparison(template.slots);
  }
}

function resolveDurationTrend(slots: DurationTrendSlots): VisualizationConfig {
  return {
    chartType: 'line',
    xAxis: {
      metadataKey: slots.endDateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    aggregation: { function: 'avg' },
    derivedMetric: {
      name: 'Duration',
      type: 'duration',
      startMetadataKey: slots.startDateField,
      endMetadataKey: slots.endDateField,
      unit: slots.unit,
    },
  };
}

function resolveCategoryBreakdown(slots: CategoryBreakdownSlots): VisualizationConfig {
  return {
    chartType: 'pie',
    category: {
      metadataKey: slots.categoryField,
      sortBy: 'value_desc',
    },
    aggregation: { function: 'count' },
  };
}

function resolvePhaseSnapshot(slots: PhaseSnapshotSlots): VisualizationConfig {
  return {
    chartType: 'bar',
    category: {
      metadataKey: slots.categoryField,
      sortBy: 'value_desc',
    },
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
    },
    aggregation: { function: 'count' },
  };
}

function resolveThroughputOverTime(slots: ThroughputOverTimeSlots): VisualizationConfig {
  return {
    chartType: 'bar',
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    aggregation: { function: 'count' },
  };
}

function resolveFieldTrend(slots: FieldTrendSlots): VisualizationConfig {
  const measureTransform = resolveMeasureTransform(slots);
  const smoothing = resolveSmoothing(slots);
  return {
    chartType: 'line',
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    derivedMetric: {
      name: slots.numericFields.length > 1 ? 'Sum of values' : slots.numericFields[0],
      type: 'sum',
      metadataKeys: slots.numericFields,
    },
    aggregation: { function: slots.aggregation },
    ...(measureTransform ? { measureTransform } : {}),
    ...(smoothing ? { smoothing } : {}),
  };
}

function resolveCategoryComparison(slots: CategoryComparisonSlots): VisualizationConfig {
  const measureTransform = resolveMeasureTransform(slots);
  return {
    chartType: 'bar',
    category: {
      metadataKey: slots.categoryField,
      sortBy: 'value_desc',
    },
    yAxis: {
      metadataKey: slots.numericField,
      type: 'number',
    },
    aggregation: { function: slots.aggregation },
    ...(measureTransform ? { measureTransform } : {}),
  };
}
