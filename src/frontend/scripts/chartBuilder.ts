// Chart.js is loaded from CDN as a global before this script runs.
declare const Chart: {
  new (canvas: HTMLCanvasElement, config: object): ChartInstance;
};

interface ChartInstance {
  destroy(): void;
}

interface ChartActiveElement {
  datasetIndex: number;
  index: number;
}

interface ChartOptions {
  onClick?: (event: unknown, elements: ChartActiveElement[]) => void;
  onHover?: (
    event: { native?: { target?: EventTarget | null } },
    elements: ChartActiveElement[]
  ) => void;
  [key: string]: unknown;
}

interface ChartConfig {
  type: string;
  data: unknown;
  options?: ChartOptions;
}

let previewChart: ChartInstance | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

// ── Detail page: render saved chart ──────────────────────────────────────────

function initDetailChart(): void {
  const canvas = document.getElementById('main-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const configStr = canvas.getAttribute('data-config');
  if (!configStr) return;
  let config: ChartConfig;
  try {
    config = JSON.parse(configStr) as ChartConfig;
  } catch {
    return;
  }

  const pointUrls = readPointUrls(canvas);
  if (pointUrls) attachPointNavigation(config, pointUrls);

  new Chart(canvas, config);
}

function readPointUrls(canvas: HTMLCanvasElement): string[] | null {
  const raw = canvas.getAttribute('data-point-urls');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function attachPointNavigation(config: ChartConfig, pointUrls: string[]): void {
  const options: ChartOptions = config.options ?? (config.options = {});
  options.onClick = (_event, elements) => {
    // Only navigate for the primary dataset; target lines (datasetIndex > 0)
    // share x-positions with real points and shouldn't trigger.
    const hit = elements.find(e => e.datasetIndex === 0);
    if (!hit) return;
    const url = pointUrls[hit.index];
    if (url) window.location.href = url;
  };
  options.onHover = (event, elements) => {
    const target = event?.native?.target as HTMLElement | null;
    if (!target || !('style' in target)) return;
    target.style.cursor = elements.some(e => e.datasetIndex === 0) ? 'pointer' : 'default';
  };
}

// ── Template picker: update card links when dataset changes ──────────────────

function initTemplatePicker(): void {
  const picker = document.getElementById('dataset-picker') as HTMLSelectElement | null;
  const grid = document.getElementById('template-grid');
  if (!picker || !grid) return;

  picker.addEventListener('change', () => {
    const dsId = picker.value;
    const links = grid.querySelectorAll<HTMLAnchorElement>('a[data-template-id]');
    for (const link of links) {
      const templateId = link.getAttribute('data-template-id');
      link.href = `/visualizations/new/${templateId}?dataset_id=${dsId}`;
    }
  });
}

// ── Template config form: live preview ───────────────────────────────────────

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    fetchPreview();
  }, 600);
}

function readFormConfig(
  form: HTMLFormElement
): { datasetId: number; templateId: string; slots: Record<string, string> } | null {
  const templateId = (form.elements.namedItem('template_id') as HTMLInputElement | null)?.value;
  const datasetIdStr = (form.elements.namedItem('dataset_id') as HTMLInputElement | null)?.value;
  const datasetId = parseInt(datasetIdStr ?? '', 10);
  if (!templateId || isNaN(datasetId)) return null;

  const slots = buildSlotsFromForm(templateId, form);
  if (Object.values(slots).some(v => !v)) return null;

  return { datasetId, templateId, slots };
}

async function doFetchPreview(
  datasetId: number,
  templateConfig: { templateId: string; slots: Record<string, string> }
): Promise<void> {
  const statusEl = document.getElementById('preview-status');
  if (statusEl) statusEl.textContent = 'Loading\u2026';
  try {
    const resp = await fetch('/api/chart-data/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId, templateConfig }),
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
  const form = document.getElementById('template-config-form') as HTMLFormElement | null;
  if (!form) return;
  const formConfig = readFormConfig(form);
  if (!formConfig) return;
  const { datasetId, templateId, slots } = formConfig;
  await doFetchPreview(datasetId, { templateId, slots });
}

type SlotMapping = Array<[slotKey: string, formName: string, fallback?: string]>;

const SLOT_MAPPINGS: Record<string, SlotMapping> = {
  duration_trend: [
    ['startDateField', 'start_date_field'],
    ['endDateField', 'end_date_field'],
    ['timeBucket', 'time_bucket', 'week'],
    ['unit', 'unit', 'days'],
  ],
  category_breakdown: [['categoryField', 'category_field']],
  phase_snapshot: [
    ['categoryField', 'category_field'],
    ['dateField', 'date_field'],
  ],
  throughput_over_time: [
    ['dateField', 'date_field'],
    ['timeBucket', 'time_bucket', 'week'],
  ],
  field_trend: [
    ['dateField', 'date_field'],
    ['numericField', 'numeric_field'],
    ['timeBucket', 'time_bucket', 'week'],
    ['aggregation', 'aggregation', 'avg'],
  ],
  category_comparison: [
    ['categoryField', 'category_field'],
    ['numericField', 'numeric_field'],
    ['aggregation', 'aggregation', 'avg'],
  ],
};

function buildSlotsFromForm(templateId: string, form: HTMLFormElement): Record<string, string> {
  const mapping = SLOT_MAPPINGS[templateId];
  if (!mapping) return {};
  const slots: Record<string, string> = {};
  for (const [slotKey, formName, fallback] of mapping) {
    const el = form.elements.namedItem(formName) as HTMLInputElement | HTMLSelectElement | null;
    slots[slotKey] = el?.value || fallback || '';
  }
  return slots;
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
  initTemplatePicker();

  const form = document.getElementById('template-config-form') as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener('change', schedulePreview);
  form.addEventListener('input', schedulePreview);

  // Initial preview
  schedulePreview();
});
