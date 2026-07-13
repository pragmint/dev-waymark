import type { TargetConfig, VisualizationConfig } from '../schemas/visualization';
import type {
  TemplateConfig,
  DurationTrendSlots,
  CategoryBreakdownSlots,
  PhaseSnapshotSlots,
  ThroughputOverTimeSlots,
  FieldTrendSlots,
  CategoryComparisonSlots,
  CombinedMetricTrendSlots,
  CompositionOverTimeSlots,
  ReferenceLine,
} from '../schemas/visualizationTemplate';

// Reference lines become horizontal-line targets on the resolved config.
function referenceLinesToTargets(lines: ReferenceLine[] | undefined): TargetConfig[] | undefined {
  if (!lines || lines.length === 0) return undefined;
  return lines.map(l => ({ type: 'horizontal_line' as const, value: l.value, label: l.label }));
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
    case 'combined_metric_trend':
      return resolveCombinedMetricTrend(template.slots);
    case 'composition_over_time':
      return resolveCompositionOverTime(template.slots);
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
    targets: referenceLinesToTargets(slots.referenceLines),
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
  return {
    chartType: 'line',
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    yAxis: {
      metadataKey: slots.numericField,
      type: 'number',
    },
    aggregation: { function: slots.aggregation },
    targets: referenceLinesToTargets(slots.referenceLines),
  };
}

function resolveCategoryComparison(slots: CategoryComparisonSlots): VisualizationConfig {
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
    targets: referenceLinesToTargets(slots.referenceLines),
  };
}

function resolveCombinedMetricTrend(slots: CombinedMetricTrendSlots): VisualizationConfig {
  return {
    chartType: 'line',
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    aggregation: { function: slots.aggregation },
    derivedMetric: {
      name: 'Combined metric',
      type: 'sum',
      metadataKeys: slots.numericFields,
    },
    targets: referenceLinesToTargets(slots.referenceLines),
  };
}

function resolveCompositionOverTime(slots: CompositionOverTimeSlots): VisualizationConfig {
  return {
    chartType: 'bar',
    xAxis: {
      metadataKey: slots.dateField,
      type: 'date',
      timeBucket: slots.timeBucket,
    },
    aggregation: { function: slots.aggregation },
    series: {
      metadataKeys: slots.numericFields,
      mode: slots.mode,
    },
  };
}
