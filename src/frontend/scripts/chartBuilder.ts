// Chart.js is loaded from CDN as a global before this script runs.
// Declare the global to satisfy TypeScript.
declare const Chart: {
  new (canvas: HTMLCanvasElement, config: object): ChartInstance;
};

interface ChartInstance {
  destroy(): void;
}

let previewChart: ChartInstance | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

// ── Detail page: render saved chart ──────────────────────────────────────────

function initDetailChart(): void {
  const canvas = document.getElementById('main-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const configStr = canvas.getAttribute('data-config');
  if (!configStr) return;
  try {
    const config = JSON.parse(configStr) as object;
    new Chart(canvas, config);
  } catch {
    // Ignore parse errors — chart won't render but page still loads
  }
}

// ── Builder: live preview ─────────────────────────────────────────────────────

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    fetchPreview();
  }, 600);
}

async function doFetchPreview(datasetId: number, config: Record<string, unknown>): Promise<void> {
  const statusEl = document.getElementById('preview-status');
  if (statusEl) statusEl.textContent = 'Loading…';
  try {
    const resp = await fetch('/api/chart-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId, config }),
    });
    if (statusEl) statusEl.textContent = '';
    if (!resp.ok) {
      const err = (await resp.json()) as { details?: unknown; error?: string };
      showPreviewWarnings(err.details ?? err.error ?? 'Unknown error');
      return;
    }
    const data = (await resp.json()) as {
      chartJsConfig: object;
      warnings: string[];
      excludedEntityCount: number;
    };
    showPreviewWarnings(data.warnings);
    renderPreview(data.chartJsConfig);
  } catch {
    if (statusEl) statusEl.textContent = '';
    showPreviewWarnings(['Failed to load preview.']);
  }
}

async function fetchPreview(): Promise<void> {
  const form = document.getElementById('viz-builder-form') as HTMLFormElement | null;
  if (!form) return;
  const datasetIdEl = document.getElementById('dataset_id') as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  const datasetId = parseInt(datasetIdEl?.value ?? '', 10);
  if (isNaN(datasetId)) return;
  const config = buildConfigFromForm(form);
  await doFetchPreview(datasetId, config);
}

async function onDatasetChange(id: string): Promise<void> {
  try {
    const resp = await fetch(`/api/dataset-fields/${encodeURIComponent(id)}`);
    if (!resp.ok) return;
    const fields = (await resp.json()) as Array<{ key: string; value_type: string }>;
    repopulateFieldSelects(fields);
  } catch {
    // Ignore network errors — field selects stay as-is
  }
  schedulePreview();
}

function repopulateFieldSelects(fields: Array<{ key: string; value_type: string }>): void {
  const selects = document.querySelectorAll<HTMLSelectElement>('[data-field-select]');
  for (const sel of selects) {
    const primaryType = sel.getAttribute('data-field-select') ?? '';
    const noneLabel = sel.getAttribute('data-none-label') ?? '— none —';
    const currentValue = sel.value;

    // Rebuild options
    sel.innerHTML = '';

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = noneLabel;
    sel.appendChild(noneOpt);

    const primary = fields.filter(f => f.value_type === primaryType);
    const others = fields.filter(f => f.value_type !== primaryType);

    for (const f of primary) {
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.key;
      if (f.key === currentValue) opt.selected = true;
      sel.appendChild(opt);
    }
    for (const f of others) {
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = `${f.key} (${f.value_type})`;
      if (f.key === currentValue) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function syncAggFn(type: string): void {
  const aggFnHidden = document.getElementById('aggregation_fn') as HTMLInputElement | null;
  const aggFnUi = document.getElementById('aggregation_fn_ui') as HTMLSelectElement | null;
  if (!aggFnHidden) return;
  aggFnHidden.value = type === 'count' ? 'count' : (aggFnUi?.value ?? 'avg');
}

function onMeasureTypeChange(type: string): void {
  const measureField = document.getElementById('measure-field');
  const measureDuration = document.getElementById('measure-duration');
  const measureAgg = document.getElementById('measure-aggregation');
  const derivedEnabled = document.getElementById(
    'derived_metric_enabled'
  ) as HTMLInputElement | null;

  if (measureField) measureField.style.display = type === 'field' ? '' : 'none';
  if (measureDuration) measureDuration.style.display = type === 'duration' ? '' : 'none';
  if (measureAgg) measureAgg.style.display = type === 'count' ? 'none' : '';

  syncAggFn(type);

  if (derivedEnabled) {
    derivedEnabled.checked = type === 'duration';
  }
}

function onChartTypeChange(type: string): void {
  const isCircular = type === 'pie' || type === 'doughnut';
  const timeSection = document.getElementById('section-time-series');
  if (timeSection) timeSection.style.display = isCircular ? 'none' : '';
}

function initTargetToggle(): void {
  const addBtn = document.getElementById('target-add-btn');
  const removeBtn = document.getElementById('target-remove-btn');
  const enabledEl = document.getElementById('target_enabled') as HTMLInputElement | null;
  const fieldsEl = document.getElementById('target-fields');

  function showTarget(on: boolean): void {
    if (fieldsEl) fieldsEl.style.display = on ? '' : 'none';
    if (enabledEl) enabledEl.checked = on;
    if (addBtn) addBtn.style.display = on ? 'none' : '';
    if (removeBtn) removeBtn.style.display = on ? '' : 'none';
    updateTargetTypeFields();
  }

  addBtn?.addEventListener('click', () => showTarget(true));
  removeBtn?.addEventListener('click', () => showTarget(false));

  const typeEl = document.getElementById('target_type');
  typeEl?.addEventListener('change', updateTargetTypeFields);
}

function updateTargetTypeFields(): void {
  const typeEl = document.getElementById('target_type') as HTMLSelectElement | null;
  const type = typeEl?.value ?? 'horizontal_line';
  const enabledEl = document.getElementById('target_enabled') as HTMLInputElement | null;
  const on = enabledEl?.checked ?? false;

  const hEl = document.getElementById('target-horizontal-fields');
  const vEl = document.getElementById('target-vertical-fields');
  const bEl = document.getElementById('target-band-fields');

  if (hEl) hEl.style.display = on && type === 'horizontal_line' ? '' : 'none';
  if (vEl) vEl.style.display = on && type === 'vertical_line' ? '' : 'none';
  if (bEl) bEl.style.display = on && type === 'band' ? '' : 'none';
}

function initUnitConversionToggle(): void {
  const btn = document.getElementById('unit-conversion-toggle');
  const panel = document.getElementById('unit-conversion');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : '';
    btn.textContent = isVisible ? '+ Unit conversion' : '− Unit conversion';
  });
}

function buildConfigFromForm(form: HTMLFormElement): Record<string, unknown> {
  const get = (name: string): string =>
    (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
  const checked = (name: string): boolean =>
    (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;
  const str = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

  const chartType = get('chart_type') || 'bar';

  const xAxisKey = get('x_axis_key');
  const xAxis = xAxisKey
    ? {
        metadataKey: xAxisKey,
        type: get('x_axis_type') || 'date',
        timeBucket: str(get('x_axis_time_bucket')),
      }
    : undefined;

  const yAxisKey = get('y_axis_key');
  const yAxis = yAxisKey
    ? {
        metadataKey: yAxisKey,
        type: get('y_axis_type') || 'number',
        unit: str(get('y_axis_unit')),
        displayUnit: str(get('y_axis_display_unit')),
      }
    : undefined;

  const categoryKey = get('category_key');
  const category = categoryKey
    ? { metadataKey: categoryKey, sortBy: str(get('category_sort_by')) }
    : undefined;

  // aggregation_fn is always read from the hidden input (managed by JS)
  const aggregation = { function: get('aggregation_fn') || 'count' };

  // derived_metric_enabled is the hidden checkbox (managed by onMeasureTypeChange)
  const derivedMetricEnabled = checked('derived_metric_enabled');
  const derivedMetric = derivedMetricEnabled
    ? {
        name: get('derived_metric_name') || 'derived',
        type: 'duration',
        startMetadataKey: get('derived_metric_start_key'),
        endMetadataKey: get('derived_metric_end_key'),
        unit: get('derived_metric_unit') || 'seconds',
      }
    : undefined;

  const targetEnabled = checked('target_enabled');
  const targetType = get('target_type');
  let target: Record<string, unknown> | undefined;
  if (targetEnabled && targetType) {
    const label = str(get('target_label'));
    if (targetType === 'horizontal_line') {
      target = { type: 'horizontal_line', value: Number(get('target_value')) || 0, label };
    } else if (targetType === 'vertical_line') {
      target = { type: 'vertical_line', value: get('target_value_str'), label };
    } else if (targetType === 'band') {
      target = {
        type: 'band',
        min: Number(get('target_min')) || 0,
        max: Number(get('target_max')) || 0,
        label,
      };
    }
  }

  return { chartType, xAxis, yAxis, category, aggregation, derivedMetric, target };
}

function renderPreview(chartConfig: object): void {
  const canvas = document.getElementById('preview-chart') as HTMLCanvasElement | null;
  if (!canvas) return;

  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }

  previewChart = new Chart(canvas, chartConfig);
}

function showPreviewWarnings(details: unknown): void {
  const warningsEl = document.getElementById('preview-warnings');
  if (!warningsEl) return;
  warningsEl.innerHTML = '';
  if (!details) return;
  const msgs: string[] = Array.isArray(details)
    ? details.map(d => (typeof d === 'object' ? JSON.stringify(d) : String(d)))
    : [String(details)];
  for (const msg of msgs) {
    const p = document.createElement('p');
    p.textContent = msg;
    p.className = 'warning';
    warningsEl.appendChild(p);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initDetailChart();

  const form = document.getElementById('viz-builder-form') as HTMLFormElement | null;
  if (!form) return;

  // Dataset change
  const datasetIdEl = document.getElementById('dataset_id');
  if (datasetIdEl && datasetIdEl.tagName === 'SELECT') {
    datasetIdEl.addEventListener('change', e => {
      const val = (e.target as HTMLSelectElement).value;
      onDatasetChange(val);
    });
  }

  // Measure type radios
  const measureRadios = form.querySelectorAll<HTMLInputElement>('input[name="measure_type"]');
  for (const radio of measureRadios) {
    radio.addEventListener('change', () => {
      onMeasureTypeChange(radio.value);
      schedulePreview();
    });
  }

  // Aggregation UI select syncs to hidden input
  const aggFnUi = document.getElementById('aggregation_fn_ui') as HTMLSelectElement | null;
  const aggFnHidden = document.getElementById('aggregation_fn') as HTMLInputElement | null;
  aggFnUi?.addEventListener('change', () => {
    if (aggFnHidden) aggFnHidden.value = aggFnUi.value;
    schedulePreview();
  });

  // Chart type radios
  const chartTypeRadios = form.querySelectorAll<HTMLInputElement>('input[name="chart_type"]');
  for (const radio of chartTypeRadios) {
    radio.addEventListener('change', () => {
      onChartTypeChange(radio.value);
      schedulePreview();
    });
  }

  // General change/input → schedule preview
  form.addEventListener('change', schedulePreview);
  form.addEventListener('input', schedulePreview);

  initTargetToggle();
  updateTargetTypeFields();
  initUnitConversionToggle();

  // Initial preview
  schedulePreview();
});
