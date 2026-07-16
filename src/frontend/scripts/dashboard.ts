// Chart.js is loaded from CDN as a global before this script runs.
declare const Chart: {
  new (canvas: HTMLCanvasElement, config: object): ChartInstance;
  getChart(canvas: HTMLCanvasElement): ChartInstance | undefined;
  register(plugin: ChartPlugin): void;
};

interface ChartScale {
  getPixelForValue(value: number): number;
  getValueForPixel(pixel: number): number | undefined;
}

interface ChartInstance {
  scales: Record<string, ChartScale | undefined>;
  chartArea: { top: number; bottom: number };
  ctx: CanvasRenderingContext2D;
  draw(): void;
  destroy(): void;
}

interface ChartPlugin {
  id: string;
  afterDraw(chart: ChartInstance): void;
}

interface ChartActiveElement {
  datasetIndex: number;
  index: number;
}

interface ChartEvent {
  type: string;
  x: number | null;
  y: number | null;
  native?: { target?: EventTarget | null };
}

interface ChartOptions {
  onClick?: (event: unknown, elements: ChartActiveElement[]) => void;
  onHover?: (event: ChartEvent, elements: ChartActiveElement[], chart: ChartInstance) => void;
  [key: string]: unknown;
}

interface ChartConfig {
  type: string;
  data: unknown;
  options?: ChartOptions;
}

type DateRangePeriod = 'all' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

interface DateRangeState {
  period: DateRangePeriod;
  offset: number;
  customStart: string | null;
  customEnd: string | null;
}

interface DashboardState {
  dashboardId: number | null;
  savedVizIds: number[];
  currentVizIds: number[];
  originalName: string;
  vizDashboardCounts: Record<number, number>;
  dateRange: DateRangeState;
}

const state: DashboardState = {
  dashboardId: null,
  savedVizIds: [],
  currentVizIds: [],
  originalName: '',
  vizDashboardCounts: {},
  dateRange: { period: 'all', offset: 0, customStart: null, customEnd: null },
};

// ── Hydration ────────────────────────────────────────────────────────────────

function readJsonEmbed<T>(id: string, fallback: T): T {
  const el = document.getElementById(id);
  if (!el?.textContent) return fallback;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return fallback;
  }
}

function hydrate(): void {
  const config = readJsonEmbed<{ dashboardId: number | null }>('dashboard-config', {
    dashboardId: null,
  });
  state.dashboardId = config.dashboardId;
  state.savedVizIds = readJsonEmbed<number[]>('dashboard-saved-viz-ids', []);
  state.currentVizIds = state.savedVizIds.slice();
  state.vizDashboardCounts = readJsonEmbed<Record<number, number>>('viz-dashboard-counts', {});
  state.dateRange = readJsonEmbed<DateRangeState>('date-range-config', state.dateRange);

  const nameInput = document.querySelector<HTMLInputElement>('[data-dashboard-name-input]');
  state.originalName = nameInput?.dataset.originalName ?? nameInput?.value ?? '';
}

// ── Chart rendering ──────────────────────────────────────────────────────────

function readPointUrls(canvas: HTMLCanvasElement): (string | null)[] | null {
  const raw = canvas.getAttribute('data-point-urls');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as (string | null)[]) : null;
  } catch {
    return null;
  }
}

function readSmoothingPointUrls(canvas: HTMLCanvasElement): (string | null)[] | null {
  const raw = canvas.getAttribute('data-smoothing-point-urls');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as (string | null)[]) : null;
  } catch {
    return null;
  }
}

function readSmoothingDatasetIndex(canvas: HTMLCanvasElement): number | null {
  const raw = canvas.getAttribute('data-smoothing-dataset-index');
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed === 'number' ? parsed : null;
}

// Point navigation covers both the main series (dataset 0) and, when present,
// the smoothing line — clicking a rolling-average point opens the entities
// from every bucket in that point's window, not just the point's own bucket.
function attachPointNavigation(
  config: ChartConfig,
  pointUrls: (string | null)[],
  smoothingPointUrls: (string | null)[] | null,
  smoothingDatasetIndex: number | null
): void {
  const urlFor = (datasetIndex: number, index: number): string | undefined => {
    if (datasetIndex === 0) return pointUrls[index] ?? undefined;
    if (smoothingPointUrls && datasetIndex === smoothingDatasetIndex) {
      return smoothingPointUrls[index] ?? undefined;
    }
    return undefined;
  };
  const isNavigable = (datasetIndex: number): boolean =>
    datasetIndex === 0 || (smoothingPointUrls != null && datasetIndex === smoothingDatasetIndex);

  const options: ChartOptions = config.options ?? (config.options = {});
  options.onClick = (_event, elements) => {
    const hit = elements.find(e => isNavigable(e.datasetIndex));
    if (!hit) return;
    const url = urlFor(hit.datasetIndex, hit.index);
    if (url) window.location.href = url;
  };
  options.onHover = (event, elements) => {
    const target = event?.native?.target as HTMLElement | null;
    if (!target || !('style' in target)) return;
    target.style.cursor = elements.some(e => isNavigable(e.datasetIndex)) ? 'pointer' : 'default';
  };
}

// The server carries a `unitLabel` hint on `options.plugins.tooltip` instead of a
// real `callbacks.label` function, since chart configs are shipped to the browser
// as JSON (functions don't survive that trip — see buildChartPlugins server-side).
// Here we turn that hint into the actual Chart.js callback before rendering.
function attachUnitTooltip(config: ChartConfig): void {
  const options: ChartOptions = config.options ?? (config.options = {});
  const plugins = (options.plugins ?? (options.plugins = {})) as Record<string, unknown>;
  const tooltip = (plugins.tooltip ?? (plugins.tooltip = {})) as Record<string, unknown>;
  const unitLabel = tooltip.unitLabel;
  if (typeof unitLabel !== 'string' || !unitLabel) return;
  tooltip.callbacks = {
    label: (ctx: { dataset: { label?: string }; parsed: { x?: number; y?: number } }) => {
      const value = ctx.parsed.y ?? ctx.parsed.x;
      return `${ctx.dataset.label ?? ''}: ${value} ${unitLabel}`;
    },
  };
}

function renderCardChart(canvas: HTMLCanvasElement): void {
  const oldChart = Chart.getChart(canvas);
  if (oldChart) {
    oldChart.destroy();
    crosshairIndex.delete(oldChart);
  }
  const raw = canvas.getAttribute('data-config');
  if (!raw) return;
  let config: ChartConfig;
  try {
    config = JSON.parse(raw) as ChartConfig;
  } catch {
    return;
  }
  const pointUrls = readPointUrls(canvas);
  if (pointUrls) {
    attachPointNavigation(
      config,
      pointUrls,
      readSmoothingPointUrls(canvas),
      readSmoothingDatasetIndex(canvas)
    );
  }
  attachUnitTooltip(config);
  const dates = extractBucketDates(config);
  const hasDates = dates.some(d => d != null);
  if (hasDates) attachCrosshairHover(config, dates);
  const chart = new Chart(canvas, config);
  wireCrosshair(canvas, chart, hasDates ? dates : []);
}

function renderCardCharts(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-config]');
  for (const canvas of canvases) renderCardChart(canvas);
}

// ── Crosshair sync ───────────────────────────────────────────────────────────
// Hovering a point on one time-series chart draws a thin vertical line at the
// matching date on every other time-series chart on the dashboard — even when
// charts use different time buckets (day/week/month/quarter/year) — by mapping
// through each chart's own parsed bucket-start dates rather than raw label text
// or shared index position.

function parseBucketLabelStart(label: string): number | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^Week of (\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{4})-(\d{2})$/.exec(label);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  m = /^(\d{4})-Q(\d)$/.exec(label);
  if (m) return Date.UTC(Number(m[1]), (Number(m[2]) - 1) * 3, 1);
  m = /^(\d{4})$/.exec(label);
  if (m) return Date.UTC(Number(m[1]), 0, 1);
  return null;
}

function extractBucketDates(config: ChartConfig): (number | null)[] {
  const data = config.data as { labels?: unknown } | undefined;
  const labels = data?.labels;
  if (!Array.isArray(labels)) return [];
  return labels.map(l => (typeof l === 'string' ? parseBucketLabelStart(l) : null));
}

interface CrosshairEntry {
  chart: ChartInstance;
  dates: (number | null)[];
}

const crosshairEntries = new Map<HTMLCanvasElement, CrosshairEntry>();
const crosshairIndex = new Map<ChartInstance, number>();

const crosshairPlugin: ChartPlugin = {
  id: 'crosshairSync',
  afterDraw(chart) {
    const index = crosshairIndex.get(chart);
    const xScale = chart.scales.x;
    if (index == null || !xScale) return;
    const x = xScale.getPixelForValue(index);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
    ctx.restore();
  },
};
Chart.register(crosshairPlugin);

function setCrosshair(chart: ChartInstance, index: number | null): void {
  if (index == null) {
    if (!crosshairIndex.has(chart)) return;
    crosshairIndex.delete(chart);
  } else {
    crosshairIndex.set(chart, index);
  }
  chart.draw();
}

// dates is ascending per chart (buckets are emitted in calendar order), so the
// match for a target date is the last bucket whose start falls at or before it.
function nearestIndexForDate(dates: (number | null)[], target: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (d == null) continue;
    if (d <= target) best = i;
    else break;
  }
  if (best != null) return best;
  const firstValid = dates.findIndex(d => d != null);
  return firstValid === -1 ? null : firstValid;
}

function clearAllCrosshairs(): void {
  for (const entry of crosshairEntries.values()) setCrosshair(entry.chart, null);
}

function attachCrosshairHover(config: ChartConfig, dates: (number | null)[]): void {
  const options: ChartOptions = config.options ?? (config.options = {});
  const prevOnHover = options.onHover;
  options.onHover = (event, elements, chart) => {
    prevOnHover?.(event, elements, chart);
    if (event.x == null) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const rawIndex = xScale.getValueForPixel(event.x);
    if (rawIndex == null) return;
    const clamped = Math.max(0, Math.min(dates.length - 1, Math.round(rawIndex)));
    const targetDate = dates[clamped];
    if (targetDate == null) return;
    for (const entry of crosshairEntries.values()) {
      setCrosshair(entry.chart, nearestIndexForDate(entry.dates, targetDate));
    }
  };
}

function wireCrosshair(
  canvas: HTMLCanvasElement,
  chart: ChartInstance,
  dates: (number | null)[]
): void {
  if (dates.length === 0) {
    crosshairEntries.delete(canvas);
    canvas.onmouseleave = null;
    return;
  }
  crosshairEntries.set(canvas, { chart, dates });
  canvas.onmouseleave = clearAllCrosshairs;
}

// ── Dirty-state tracking ─────────────────────────────────────────────────────

function currentName(): string {
  const input = document.querySelector<HTMLInputElement>('[data-dashboard-name-input]');
  return input?.value ?? '';
}

function isDirty(): boolean {
  if (state.dashboardId == null) return false;
  if (currentName().trim() !== state.originalName.trim()) return true;
  if (state.currentVizIds.length !== state.savedVizIds.length) return true;
  return state.currentVizIds.some((id, i) => id !== state.savedVizIds[i]);
}

function recomputeDirty(): void {
  const dirty = isDirty();
  const save = document.querySelector<HTMLButtonElement>('[data-dashboard-save-submit]');
  if (save) save.hidden = !dirty;
}

// ── Dashboard combobox + select ──────────────────────────────────────────────

function wireDashboardSelect(): void {
  const select = document.querySelector<HTMLSelectElement>('[data-dashboard-select]');
  if (!select) return;
  select.addEventListener('change', () => {
    const url = select.value;
    if (url) window.location.href = url;
  });
}

function wireDashboardCombobox(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-dashboard-combo-toggle]');
  const list = document.querySelector<HTMLUListElement>('[data-dashboard-combo-list]');
  if (!toggle || !list) return;

  const close = () => {
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = !list.hidden;
    if (open) close();
    else {
      list.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
  document.addEventListener('click', e => {
    if (!list.contains(e.target as Node) && !toggle.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
}

function wireNameInput(): void {
  const input = document.querySelector<HTMLInputElement>('[data-dashboard-name-input]');
  if (!input) return;
  input.addEventListener('input', recomputeDirty);
}

function wireSaveChanges(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-dashboard-save-submit]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (state.dashboardId == null) return;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/visualizations/dashboards/${state.dashboardId}`;
    form.style.display = 'none';

    const nameInput = document.createElement('input');
    nameInput.name = 'name';
    nameInput.value = currentName().trim();
    form.appendChild(nameInput);

    for (const id of state.currentVizIds) {
      const i = document.createElement('input');
      i.name = 'viz_ids[]';
      i.value = String(id);
      form.appendChild(i);
    }
    document.body.appendChild(form);
    form.submit();
  });
}

function wireDeleteConfirm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-dashboard-delete-form]');
  if (!form) return;
  const name = form.dataset.dashboardName ?? '';
  form.addEventListener('submit', e => {
    if (!confirm(`Delete dashboard "${name}"?`)) e.preventDefault();
  });
}

// ── Create-panel ─────────────────────────────────────────────────────────────

function wireCreatePanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-dashboard-create-panel]');
  if (!panel) return;
  const input = panel.querySelector<HTMLInputElement>('[data-dashboard-create-input]');
  const cancel = panel.querySelector<HTMLButtonElement>('[data-dashboard-create-cancel]');
  const openers = document.querySelectorAll<HTMLButtonElement>('[data-dashboard-create-open]');
  for (const btn of openers) {
    btn.addEventListener('click', () => {
      panel.hidden = false;
      input?.focus();
    });
  }
  cancel?.addEventListener('click', () => {
    panel.hidden = true;
    if (input) input.value = '';
  });
}

// ── Add visualization picker ─────────────────────────────────────────────────

function wireAddVizSelect(): void {
  const select = document.querySelector<HTMLSelectElement>('[data-add-viz]');
  if (!select) return;
  select.addEventListener('change', () => {
    const value = select.value;
    if (!value) return;
    if (value === '__new__') {
      select.value = '';
      openCreateModal();
      return;
    }
    const vizId = parseInt(value, 10);
    if (isNaN(vizId) || state.dashboardId == null) return;
    addExistingViz(vizId);
    select.value = '';
  });
}

async function addExistingViz(vizId: number): Promise<void> {
  if (state.dashboardId == null) return;
  // Persist via standard form-post so server-side viz list stays canonical.
  const form = document.createElement('form');
  form.method = 'post';
  form.action = `/visualizations/dashboards/${state.dashboardId}/visualizations`;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.name = 'visualization_id';
  input.value = String(vizId);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

// ── Remove visualization (X button) ─────────────────────────────────────────

let activePopover: HTMLElement | null = null;

function closeRemovePopover(): void {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
    document.removeEventListener('click', onDocClickClose, true);
    document.removeEventListener('keydown', onEscClose);
  }
}

function onDocClickClose(e: Event): void {
  if (activePopover && !activePopover.contains(e.target as Node)) closeRemovePopover();
}

function onEscClose(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeRemovePopover();
}

function wireRemoveButtons(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-viz]');
    if (!btn) return;
    const vizId = parseInt(btn.dataset.removeViz ?? '', 10);
    if (isNaN(vizId) || state.dashboardId == null) return;
    const onMultiple = btn.dataset.onMultiple === 'true';
    if (onMultiple) {
      unlinkViz(vizId);
    } else {
      openRemoveConfirm(vizId, btn);
    }
  });
}

function openRemoveConfirm(vizId: number, anchor: HTMLElement): void {
  closeRemovePopover();
  const panel = document.createElement('div');
  panel.className = 'viz-remove-confirm';

  const unlinkBtn = document.createElement('button');
  unlinkBtn.type = 'button';
  unlinkBtn.className = 'filter-btn';
  unlinkBtn.textContent = 'Remove from this dashboard';
  unlinkBtn.addEventListener('click', () => {
    closeRemovePopover();
    unlinkViz(vizId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'filter-btn filter-btn-danger';
  deleteBtn.textContent = 'Remove and delete visualization';
  deleteBtn.addEventListener('click', () => {
    closeRemovePopover();
    deleteVizEntirely(vizId);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'filter-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeRemovePopover);

  panel.appendChild(unlinkBtn);
  panel.appendChild(deleteBtn);
  panel.appendChild(cancelBtn);
  document.body.appendChild(panel);

  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
  panel.style.left = `${Math.max(8, rect.right + window.scrollX - panel.offsetWidth)}px`;

  activePopover = panel;
  // Defer so the click that opened the popover doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('click', onDocClickClose, true);
    document.addEventListener('keydown', onEscClose);
  }, 0);
}

async function unlinkViz(vizId: number): Promise<void> {
  if (state.dashboardId == null) return;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = `/visualizations/dashboards/${state.dashboardId}/visualizations/${vizId}/delete`;
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
}

async function deleteVizEntirely(vizId: number): Promise<void> {
  try {
    await fetch(`/api/visualizations/${vizId}/delete`, { method: 'POST' });
    if (state.dashboardId != null) {
      window.location.href = `/visualizations?dashboard=${state.dashboardId}`;
    } else {
      window.location.href = '/visualizations';
    }
  } catch {
    /* surface via reload */
    window.location.reload();
  }
}

// ── Drag-and-drop reorder ────────────────────────────────────────────────────

let dragSourceId: number | null = null;

function clearDropFeedback(grid: HTMLElement): void {
  grid.querySelectorAll('.drop-before, .drop-after').forEach(el => {
    el.classList.remove('drop-before');
    el.classList.remove('drop-after');
  });
}

function reorderGridDom(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;
  const cardByVizId = new Map<number, HTMLElement>();
  grid.querySelectorAll<HTMLElement>('.dashboard-viz-card').forEach(card => {
    const id = parseInt(card.dataset.vizId ?? '', 10);
    if (!isNaN(id)) cardByVizId.set(id, card);
  });
  grid.querySelectorAll('.dashboard-viz-card').forEach(el => el.remove());
  for (const id of state.currentVizIds) {
    const card = cardByVizId.get(id);
    if (card) grid.appendChild(card);
  }
}

// Which edge of the target card is closer to the cursor. Callers translate this
// into an insert-before / insert-after index.
function dropSide(card: HTMLElement, clientX: number): 'before' | 'after' {
  const rect = card.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function wireDragReorder(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;

  grid.addEventListener('dragstart', e => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.dashboard-viz-card');
    if (!card) return;
    const id = parseInt(card.dataset.vizId ?? '', 10);
    if (isNaN(id)) return;
    dragSourceId = id;
    card.classList.add('is-dragging');
    if (e.dataTransfer) {
      // Firefox refuses to initiate a drag unless setData is called here.
      e.dataTransfer.setData('text/plain', String(id));
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  grid.addEventListener('dragend', () => {
    dragSourceId = null;
    grid.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    clearDropFeedback(grid);
  });

  grid.addEventListener('dragover', e => {
    if (dragSourceId == null) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.dashboard-viz-card');
    if (!card) return;
    const targetId = parseInt(card.dataset.vizId ?? '', 10);
    if (isNaN(targetId) || targetId === dragSourceId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const side = dropSide(card, e.clientX);
    clearDropFeedback(grid);
    card.classList.add(side === 'before' ? 'drop-before' : 'drop-after');
  });

  grid.addEventListener('drop', e => {
    if (dragSourceId == null) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.dashboard-viz-card');
    if (!card) return;
    const targetId = parseInt(card.dataset.vizId ?? '', 10);
    if (isNaN(targetId) || targetId === dragSourceId) return;
    e.preventDefault();
    const side = dropSide(card, e.clientX);

    const sourceIndex = state.currentVizIds.indexOf(dragSourceId);
    const targetIndex = state.currentVizIds.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const next = state.currentVizIds.slice();
    next.splice(sourceIndex, 1);
    // Recompute target index after removal: if source came before target, the
    // target index has shifted left by one.
    const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertAt = side === 'before' ? adjustedTarget : adjustedTarget + 1;
    next.splice(insertAt, 0, dragSourceId);
    state.currentVizIds = next;
    reorderGridDom();
    clearDropFeedback(grid);
    recomputeDirty();
  });
}

// ── Create-viz modal ─────────────────────────────────────────────────────────

interface PresetEntry {
  id: number;
  name: string;
}
interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  chartType: string;
}
interface AvailableField {
  key: string;
  value_type: 'string' | 'number' | 'date' | 'boolean';
}

interface SlotFieldDef {
  slotKey: string;
  formName: string;
  label: string;
  kind: 'field' | 'multi_field' | 'time_bucket' | 'aggregation' | 'unit' | 'number' | 'text';
  primaryType?: 'string' | 'number' | 'date';
  defaultValue?: string;
  description?: string;
  // Defaults to true when omitted — set false for slots the user may leave blank
  // (e.g. the optional measure-transform fields below).
  required?: boolean;
}

const TEMPLATE_SLOT_DEFS: Record<string, SlotFieldDef[]> = {
  duration_trend: [
    {
      slotKey: 'startDateField',
      formName: 'start_date_field',
      label: 'Start date field',
      kind: 'field',
      primaryType: 'date',
      description: 'The earlier date — marks when the phase begins.',
    },
    {
      slotKey: 'endDateField',
      formName: 'end_date_field',
      label: 'End date field',
      kind: 'field',
      primaryType: 'date',
      description:
        'The later date — marks when the phase ends. Also sets the x-axis: entities are bucketed by this date.',
    },
    {
      slotKey: 'timeBucket',
      formName: 'time_bucket',
      label: 'Time bucket',
      kind: 'time_bucket',
      defaultValue: 'week',
      description: 'Groups entities into day/week/month/etc. buckets along the x-axis.',
    },
    {
      slotKey: 'unit',
      formName: 'unit',
      label: 'Unit',
      kind: 'unit',
      defaultValue: 'days',
      description: 'Units the duration (end minus start) is displayed in.',
    },
  ],
  category_breakdown: [
    {
      slotKey: 'categoryField',
      formName: 'category_field',
      label: 'Category field',
      kind: 'field',
      primaryType: 'string',
      description:
        "Entities are counted and grouped by this field's value — one slice per distinct value.",
    },
  ],
  phase_snapshot: [
    {
      slotKey: 'categoryField',
      formName: 'category_field',
      label: 'Phase / category field',
      kind: 'field',
      primaryType: 'string',
      description: "Entities are grouped into bars by this field's value.",
    },
    {
      slotKey: 'dateField',
      formName: 'date_field',
      label: 'Date field',
      kind: 'field',
      primaryType: 'date',
      description:
        'Sets the x-axis — entities are compared across time windows based on this date.',
    },
  ],
  throughput_over_time: [
    {
      slotKey: 'dateField',
      formName: 'date_field',
      label: 'Date field',
      kind: 'field',
      primaryType: 'date',
      description: 'Sets the x-axis — entities are counted per time bucket based on this date.',
    },
    {
      slotKey: 'timeBucket',
      formName: 'time_bucket',
      label: 'Time bucket',
      kind: 'time_bucket',
      defaultValue: 'week',
      description: 'Groups entities into day/week/month/etc. buckets along the x-axis.',
    },
  ],
  field_trend: [
    {
      slotKey: 'dateField',
      formName: 'date_field',
      label: 'Date field',
      kind: 'field',
      primaryType: 'date',
      description:
        'Sets the x-axis — entities are grouped into time buckets based on this date, then the numeric field(s) are aggregated within each bucket.',
    },
    {
      slotKey: 'numericFields',
      formName: 'numeric_fields',
      label: 'Numeric field(s) — select multiple to sum',
      kind: 'multi_field',
      primaryType: 'number',
      description:
        'The value plotted on the y-axis. Selecting multiple fields sums them per entity before aggregating.',
    },
    {
      slotKey: 'timeBucket',
      formName: 'time_bucket',
      label: 'Time bucket',
      kind: 'time_bucket',
      defaultValue: 'week',
      description: 'Groups entities into day/week/month/etc. buckets along the x-axis.',
    },
    {
      slotKey: 'aggregation',
      formName: 'aggregation',
      label: 'Aggregation',
      kind: 'aggregation',
      defaultValue: 'avg',
      description:
        'How values within each time bucket are combined into a single point (e.g. average, sum, median).',
    },
    {
      slotKey: 'unitDivisor',
      formName: 'unit_divisor',
      label: 'Unit divisor (optional)',
      kind: 'number',
      required: false,
      description:
        'Divide the raw value by this number before displaying — e.g. 86400 to turn seconds into days. Leave blank for no transform.',
    },
    {
      slotKey: 'unitLabel',
      formName: 'unit_label',
      label: 'Unit label (optional)',
      kind: 'text',
      required: false,
      description:
        'Shown on the axis and in tooltips, e.g. "days". Required to activate the divisor above.',
    },
    {
      slotKey: 'smoothingWindow',
      formName: 'smoothing_window',
      label: 'Smoothing window (optional)',
      kind: 'number',
      required: false,
      description:
        'Adds a second line tracing the rolling average of the previous N points, e.g. 4 to smooth over the last 4 buckets. Leave blank for no smoothing line.',
    },
  ],
  category_comparison: [
    {
      slotKey: 'categoryField',
      formName: 'category_field',
      label: 'Category field',
      kind: 'field',
      primaryType: 'string',
      description: "Entities are grouped into bars by this field's value.",
    },
    {
      slotKey: 'numericField',
      formName: 'numeric_field',
      label: 'Numeric field',
      kind: 'field',
      primaryType: 'number',
      description: 'The value plotted on the y-axis, aggregated within each category.',
    },
    {
      slotKey: 'aggregation',
      formName: 'aggregation',
      label: 'Aggregation',
      kind: 'aggregation',
      defaultValue: 'avg',
      description:
        'How values within each category are combined into a single bar (e.g. average, sum, median).',
    },
    {
      slotKey: 'unitDivisor',
      formName: 'unit_divisor',
      label: 'Unit divisor (optional)',
      kind: 'number',
      required: false,
      description:
        'Divide the raw value by this number before displaying — e.g. 86400 to turn seconds into days. Leave blank for no transform.',
    },
    {
      slotKey: 'unitLabel',
      formName: 'unit_label',
      label: 'Unit label (optional)',
      kind: 'text',
      required: false,
      description:
        'Shown on the axis and in tooltips, e.g. "days". Required to activate the divisor above.',
    },
  ],
};

interface ModalState {
  mode: 'create' | 'edit';
  editVizId: number | null;
  editDashboards: { id: number; name: string }[];
  presetId: number | null;
  templateId: string | null;
  name: string;
  description: string;
  layout: 'normal' | 'wide';
  slots: Record<string, string | string[]>;
  availableFields: AvailableField[];
  warnings: string[];
}

let modalState: ModalState = {
  mode: 'create',
  editVizId: null,
  editDashboards: [],
  presetId: null,
  templateId: null,
  name: '',
  description: '',
  layout: 'normal',
  slots: {},
  availableFields: [],
  warnings: [],
};
let modalPreviewChart: ChartInstance | null = null;
let modalPreviewTimer: ReturnType<typeof setTimeout> | null = null;

function getModal(): HTMLDialogElement | null {
  return document.getElementById('viz-create-modal') as HTMLDialogElement | null;
}

function resetModalState(): void {
  modalState = {
    mode: 'create',
    editVizId: null,
    editDashboards: [],
    presetId: null,
    templateId: null,
    name: '',
    description: '',
    layout: 'normal',
    slots: {},
    availableFields: [],
    warnings: [],
  };
  if (modalPreviewChart) {
    modalPreviewChart.destroy();
    modalPreviewChart = null;
  }
  if (modalPreviewTimer) {
    clearTimeout(modalPreviewTimer);
    modalPreviewTimer = null;
  }
}

function openCreateModal(): void {
  const dialog = getModal();
  if (!dialog) return;
  resetModalState();
  renderModal();
  dialog.showModal();
}

async function openEditModal(vizId: number): Promise<void> {
  const dialog = getModal();
  if (!dialog) return;
  resetModalState();
  modalState.mode = 'edit';
  modalState.editVizId = vizId;
  dialog.showModal();

  const [detailResp, dashResp] = await Promise.all([
    fetch(`/api/visualizations/${vizId}`),
    fetch(`/api/visualizations/${vizId}/dashboards`),
  ]);
  if (!detailResp.ok) {
    showModalWarnings(['Failed to load visualization.']);
    return;
  }
  const detail = (await detailResp.json()) as {
    id: number;
    name: string;
    description: string | null;
    presetId: number;
    templateConfig: { templateId: string; slots: Record<string, string | string[]> } | null;
    layout?: string;
  };
  if (!detail.templateConfig) {
    showModalWarnings(['This visualization has no template config and cannot be edited here.']);
    return;
  }
  modalState.presetId = detail.presetId;
  modalState.templateId = detail.templateConfig.templateId;
  modalState.name = detail.name;
  modalState.description = detail.description ?? '';
  modalState.layout = detail.layout === 'wide' ? 'wide' : 'normal';
  modalState.slots = { ...detail.templateConfig.slots };

  if (dashResp.ok) {
    const d = (await dashResp.json()) as { dashboards: { id: number; name: string }[] };
    modalState.editDashboards = d.dashboards;
  }

  // Load available fields for the preset so the slot dropdowns render.
  try {
    const fieldsResp = await fetch(`/api/preset-fields/${detail.presetId}`);
    modalState.availableFields = fieldsResp.ok
      ? ((await fieldsResp.json()) as AvailableField[])
      : [];
  } catch {
    modalState.availableFields = [];
  }

  renderModal();
}

function closeModal(): void {
  const dialog = getModal();
  if (!dialog) return;
  if (modalPreviewChart) {
    modalPreviewChart.destroy();
    modalPreviewChart = null;
  }
  dialog.close();
}

function renderModal(): void {
  const dialog = getModal();
  if (!dialog) return;
  if (modalPreviewChart) {
    modalPreviewChart.destroy();
    modalPreviewChart = null;
  }
  dialog.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'viz-modal-header';
  const title = document.createElement('h2');
  title.className = 'viz-modal-title';
  title.textContent = modalState.mode === 'edit' ? 'Edit visualization' : 'New visualization';
  header.appendChild(title);
  dialog.appendChild(header);

  const body = document.createElement('div');
  body.className = 'viz-modal-body';
  body.appendChild(renderDatasetSection());
  body.appendChild(renderTemplateSection());
  body.appendChild(renderConfigSection());
  dialog.appendChild(body);

  dialog.appendChild(renderModalFooter());

  if (modalState.presetId != null && modalState.templateId != null) {
    scheduleModalPreview();
  }
}

function renderModalFooter(): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'viz-modal-footer';
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  footer.appendChild(spacer);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'filter-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal);
  footer.appendChild(cancel);

  if (modalState.mode === 'create') {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'filter-btn filter-btn-attention';
    save.textContent = 'Save';
    save.addEventListener('click', () => void saveModalCreate());
    footer.appendChild(save);
  } else {
    const onMultiple = modalState.editDashboards.length > 1;
    const dashList = modalState.editDashboards.map(d => d.name).join(', ');
    const saveChanges = document.createElement('button');
    saveChanges.type = 'button';
    saveChanges.className = onMultiple ? 'filter-btn' : 'filter-btn filter-btn-attention';
    saveChanges.textContent = onMultiple ? `Save changes (used on ${dashList})` : 'Save changes';
    saveChanges.addEventListener('click', () => void saveModalEditInPlace());
    footer.appendChild(saveChanges);

    const saveAsNew = document.createElement('button');
    saveAsNew.type = 'button';
    saveAsNew.className = onMultiple ? 'filter-btn filter-btn-attention' : 'filter-btn';
    saveAsNew.textContent = 'Save as new';
    saveAsNew.addEventListener('click', () => void saveModalEditAsNew());
    footer.appendChild(saveAsNew);
  }
  return footer;
}

function sectionShell(stepNum: number, titleText: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'viz-modal-section';
  section.dataset.section = String(stepNum);
  const h = document.createElement('h3');
  h.className = 'viz-modal-section-title';
  h.textContent = `${stepNum}. ${titleText}`;
  section.appendChild(h);
  return section;
}

function sectionPlaceholder(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'viz-modal-section-placeholder';
  p.textContent = text;
  return p;
}

function renderDatasetSection(): HTMLElement {
  const section = sectionShell(1, 'Dataset');
  const presets = readJsonEmbed<PresetEntry[]>('presets-list', []);
  if (presets.length === 0) {
    section.appendChild(
      sectionPlaceholder('No datasets (presets) found. Create one on the Entities page first.')
    );
    return section;
  }
  const label = document.createElement('label');
  label.className = 'filter-widget-label';
  label.textContent = 'Choose a dataset';
  section.appendChild(label);
  const select = document.createElement('select');
  select.className = 'filter-select';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— Pick a dataset —';
  select.appendChild(blank);
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.name;
    if (modalState.presetId === p.id) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const id = parseInt(select.value, 10);
    if (isNaN(id)) return;
    void onPresetChange(id);
  });
  section.appendChild(select);
  return section;
}

async function onPresetChange(presetId: number): Promise<void> {
  captureFormState();
  modalState.presetId = presetId;
  try {
    const resp = await fetch(`/api/preset-fields/${presetId}`);
    modalState.availableFields = resp.ok ? ((await resp.json()) as AvailableField[]) : [];
  } catch {
    modalState.availableFields = [];
  }
  renderModal();
}

function renderTemplateSection(): HTMLElement {
  const section = sectionShell(2, 'Template');
  const templates = readJsonEmbed<TemplateEntry[]>('templates-list', []);
  const grid = document.createElement('div');
  grid.className = 'viz-modal-template-grid';
  for (const t of templates) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'viz-modal-template-card';
    if (modalState.templateId === t.id) card.classList.add('is-selected');
    const name = document.createElement('span');
    name.className = 'viz-modal-template-name';
    name.textContent = t.name;
    const desc = document.createElement('span');
    desc.className = 'viz-modal-template-description';
    desc.textContent = t.description;
    card.appendChild(name);
    card.appendChild(desc);
    card.addEventListener('click', () => onTemplateChange(t.id));
    grid.appendChild(card);
  }
  section.appendChild(grid);
  return section;
}

function onTemplateChange(templateId: string): void {
  if (modalState.templateId === templateId) return;
  captureFormState();
  modalState.templateId = templateId;
  // Slot keys are template-specific, so clear them; name/description are preserved.
  modalState.slots = {};
  renderModal();
}

function renderConfigSection(): HTMLElement {
  const section = sectionShell(3, 'Configure');
  const tid = modalState.templateId;
  const slotDefs = tid ? TEMPLATE_SLOT_DEFS[tid] : null;

  if (modalState.presetId == null) {
    section.appendChild(sectionPlaceholder('Pick a dataset to begin configuring.'));
    return section;
  }
  if (!tid || !slotDefs) {
    section.appendChild(sectionPlaceholder('Pick a template to configure its fields.'));
    return section;
  }

  const form = document.createElement('form');
  form.id = 'viz-modal-form';
  form.className = 'viz-modal-fields';
  form.addEventListener('input', () => scheduleModalPreview());
  form.addEventListener('change', () => scheduleModalPreview());
  form.addEventListener('submit', e => e.preventDefault());

  form.appendChild(field('Name', 'text', 'name', modalState.name, true));
  form.appendChild(field('Description', 'text', 'description', modalState.description, false));
  form.appendChild(
    selectField('Layout width', 'layout', modalState.layout, [
      ['normal', 'Normal'],
      ['wide', 'Double wide'],
    ])
  );

  for (const def of slotDefs) {
    form.appendChild(buildSlotField(def, modalState.slots[def.slotKey] ?? def.defaultValue ?? ''));
  }

  section.appendChild(form);

  const warningsBox = document.createElement('div');
  warningsBox.id = 'viz-modal-warnings';
  section.appendChild(warningsBox);

  const previewWrap = document.createElement('div');
  previewWrap.style.marginTop = '12px';
  const canvas = document.createElement('canvas');
  canvas.id = 'viz-modal-preview';
  canvas.className = 'viz-modal-preview-canvas';
  previewWrap.appendChild(canvas);
  section.appendChild(previewWrap);

  return section;
}

function captureFormState(): void {
  const captured = readModalForm();
  if (!captured) return;
  modalState.name = captured.name;
  modalState.description = captured.description;
  modalState.layout = captured.layout;
  modalState.slots = captured.slots;
}

function field(
  label: string,
  type: 'text',
  name: string,
  value: string,
  required: boolean
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const lab = document.createElement('label');
  lab.className = 'filter-widget-label';
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.className = 'filter-input';
  input.value = value;
  if (required) input.required = true;
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

function selectField(
  label: string,
  name: string,
  value: string,
  options: [string, string][]
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const lab = document.createElement('label');
  lab.className = 'filter-widget-label';
  lab.textContent = label;
  const select = document.createElement('select');
  select.className = 'filter-select';
  select.name = name;
  for (const [v, l] of options) select.appendChild(opt(v, l, value === v));
  wrap.appendChild(lab);
  wrap.appendChild(select);
  return wrap;
}

const AGGREGATION_OPTIONS: [string, string][] = [
  ['avg', 'Average'],
  ['sum', 'Sum'],
  ['min', 'Min'],
  ['max', 'Max'],
  ['median', 'Median'],
  ['p75', 'P75'],
  ['p85', 'P85'],
  ['p90', 'P90'],
  ['p95', 'P95'],
  ['p99', 'P99'],
];

function populateMultiFieldOptions(
  select: HTMLSelectElement,
  def: SlotFieldDef,
  selected: string[]
): void {
  if (!def.primaryType) return;
  const matching = modalState.availableFields.filter(f => f.value_type === def.primaryType);
  for (const f of matching) select.appendChild(opt(f.key, f.key, selected.includes(f.key)));
}

function populateSingleSlotOptions(
  select: HTMLSelectElement,
  def: SlotFieldDef,
  single: string
): void {
  if (def.kind === 'field' && def.primaryType) {
    const matching = modalState.availableFields.filter(f => f.value_type === def.primaryType);
    select.appendChild(opt('', '-- select --'));
    for (const f of matching) select.appendChild(opt(f.key, f.key, single === f.key));
  } else if (def.kind === 'time_bucket') {
    for (const b of ['day', 'week', 'month', 'quarter', 'year'])
      select.appendChild(opt(b, b, single === b));
  } else if (def.kind === 'aggregation') {
    for (const [v, lbl] of AGGREGATION_OPTIONS) select.appendChild(opt(v, lbl, single === v));
  } else if (def.kind === 'unit') {
    for (const u of ['seconds', 'minutes', 'hours', 'days', 'weeks'])
      select.appendChild(opt(u, u, single === u));
  }
}

function buildSlotLabel(def: SlotFieldDef): HTMLLabelElement {
  const lab = document.createElement('label');
  lab.className = 'filter-widget-label';
  const title = document.createElement('span');
  title.className = 'form-field-title';
  title.textContent = def.label;
  lab.appendChild(title);
  if (def.description) {
    const hint = document.createElement('span');
    hint.className = 'form-field-hint';
    hint.textContent = ` - ${def.description}`;
    lab.appendChild(hint);
  }
  return lab;
}

function buildSlotInput(def: SlotFieldDef, value: string | string[]): HTMLInputElement {
  const single = Array.isArray(value) ? (value[0] ?? '') : value;
  const input = document.createElement('input');
  input.type = def.kind === 'number' ? 'number' : 'text';
  input.name = def.formName;
  input.className = 'filter-input';
  input.value = single;
  if (def.kind === 'number') input.step = 'any';
  return input;
}

function buildSlotField(def: SlotFieldDef, value: string | string[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  wrap.appendChild(buildSlotLabel(def));

  if (def.kind === 'number' || def.kind === 'text') {
    wrap.appendChild(buildSlotInput(def, value));
    return wrap;
  }

  const select = document.createElement('select');
  select.className = 'filter-select';
  select.name = def.formName;

  if (def.kind === 'multi_field') {
    select.multiple = true;
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    populateMultiFieldOptions(select, def, selected);
  } else {
    const single = Array.isArray(value) ? (value[0] ?? '') : value;
    populateSingleSlotOptions(select, def, single);
  }
  wrap.appendChild(select);

  return wrap;
}

function opt(value: string, label: string, selected = false): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function readModalForm(): {
  name: string;
  description: string;
  layout: 'normal' | 'wide';
  slots: Record<string, string | string[]>;
} | null {
  const form = document.getElementById('viz-modal-form') as HTMLFormElement | null;
  if (!form) return null;
  const name = ((form.elements.namedItem('name') as HTMLInputElement | null)?.value ?? '').trim();
  const description = (
    (form.elements.namedItem('description') as HTMLInputElement | null)?.value ?? ''
  ).trim();
  const layoutValue = (form.elements.namedItem('layout') as HTMLSelectElement | null)?.value;
  const layout: 'normal' | 'wide' = layoutValue === 'wide' ? 'wide' : 'normal';
  const tid = modalState.templateId;
  if (!tid) return null;
  const slots: Record<string, string | string[]> = {};
  for (const def of TEMPLATE_SLOT_DEFS[tid] ?? []) {
    if (def.kind === 'multi_field') {
      const el = form.elements.namedItem(def.formName) as HTMLSelectElement | null;
      slots[def.slotKey] = el ? Array.from(el.selectedOptions).map(o => o.value) : [];
    } else {
      const el = form.elements.namedItem(def.formName) as
        | HTMLSelectElement
        | HTMLInputElement
        | null;
      slots[def.slotKey] = el?.value || def.defaultValue || '';
    }
  }
  return { name, description, layout, slots };
}

function isSlotEmpty(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length === 0 : !value;
}

// Only slots marked required (the default) must be filled before preview/save —
// e.g. the optional unit-transform fields may be left blank.
function hasEmptyRequiredSlot(
  templateId: string,
  slots: Record<string, string | string[]>
): boolean {
  const defs = TEMPLATE_SLOT_DEFS[templateId] ?? [];
  return defs
    .filter(def => def.required !== false)
    .some(def => isSlotEmpty(slots[def.slotKey] ?? ''));
}

function scheduleModalPreview(): void {
  if (modalPreviewTimer) clearTimeout(modalPreviewTimer);
  modalPreviewTimer = setTimeout(() => {
    modalPreviewTimer = null;
    runModalPreview();
  }, 500);
}

async function runModalPreview(): Promise<void> {
  const form = readModalForm();
  if (!form || modalState.templateId == null || modalState.presetId == null) return;
  modalState.name = form.name;
  modalState.description = form.description;
  modalState.slots = form.slots;
  if (hasEmptyRequiredSlot(modalState.templateId, form.slots)) return;

  const warningsEl = document.getElementById('viz-modal-warnings');
  if (warningsEl) warningsEl.innerHTML = '';

  try {
    await fetchAndRenderModalPreview(form.slots);
  } catch {
    showModalWarnings(['Failed to load preview.']);
  }
}

async function fetchAndRenderModalPreview(slots: Record<string, string | string[]>): Promise<void> {
  const resp = await fetch('/api/chart-data/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      presetId: modalState.presetId,
      templateConfig: { templateId: modalState.templateId, slots },
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { details?: unknown; error?: string };
    showModalWarnings(err.details ?? err.error ?? 'Unknown error');
    return;
  }
  const data = (await resp.json()) as {
    chartJsConfig: ChartConfig;
    warnings: string[];
    excludedEntitiesUrl?: string | null;
  };
  if (data.warnings.length > 0) showModalWarnings(data.warnings, data.excludedEntitiesUrl ?? null);
  const canvas = document.getElementById('viz-modal-preview') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (modalPreviewChart) modalPreviewChart.destroy();
  attachUnitTooltip(data.chartJsConfig);
  modalPreviewChart = new Chart(canvas, data.chartJsConfig);
}

function showModalWarnings(details: unknown, excludedEntitiesUrl: string | null = null): void {
  const el = document.getElementById('viz-modal-warnings');
  if (!el) return;
  el.innerHTML = '';
  const msgs: string[] = Array.isArray(details)
    ? details.map(d => (typeof d === 'object' ? JSON.stringify(d) : String(d)))
    : [String(details)];
  for (const msg of msgs) {
    const p = document.createElement('p');
    p.textContent = msg;
    p.className = 'warning';
    el.appendChild(p);
  }
  if (excludedEntitiesUrl) {
    const p = document.createElement('p');
    p.className = 'warning';
    const a = document.createElement('a');
    a.href = excludedEntitiesUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'warning-link';
    a.textContent = 'View excluded entities →';
    p.appendChild(a);
    el.appendChild(p);
  }
}

function validateAndReadForm(): {
  name: string;
  description: string;
  layout: 'normal' | 'wide';
  slots: Record<string, string | string[]>;
} | null {
  if (modalState.presetId == null) {
    alert('Pick a dataset first.');
    return null;
  }
  if (modalState.templateId == null) {
    alert('Pick a template first.');
    return null;
  }
  const form = readModalForm();
  if (!form) return null;
  if (!form.name) {
    showModalWarnings(['Name is required.']);
    return null;
  }
  if (hasEmptyRequiredSlot(modalState.templateId, form.slots)) {
    showModalWarnings(['Fill in every configuration field.']);
    return null;
  }
  return form;
}

async function saveModalCreate(): Promise<void> {
  const form = validateAndReadForm();
  if (!form) return;
  const resp = await fetch('/api/visualizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
      presetId: modalState.presetId,
      templateConfig: { templateId: modalState.templateId, slots: form.slots },
      layout: form.layout,
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { details?: unknown; error?: string };
    showModalWarnings(err.details ?? err.error ?? 'Failed to save.');
    return;
  }
  const { id } = (await resp.json()) as { id: number };
  await addOrReload(id);
}

async function saveModalEditInPlace(): Promise<void> {
  const form = validateAndReadForm();
  if (!form || modalState.editVizId == null) return;
  const resp = await fetch(`/api/visualizations/${modalState.editVizId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
      presetId: modalState.presetId,
      templateConfig: { templateId: modalState.templateId, slots: form.slots },
      layout: form.layout,
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { details?: unknown; error?: string };
    showModalWarnings(err.details ?? err.error ?? 'Failed to save.');
    return;
  }
  closeModal();
  reloadDashboard();
}

async function saveModalEditAsNew(): Promise<void> {
  // "Save as new" is functionally identical to creating from scratch — POST a new viz
  // (with the same preset + template + slots, possibly tweaked) and auto-add to current dashboard.
  await saveModalCreate();
}

async function addOrReload(vizId: number): Promise<void> {
  if (state.dashboardId == null) {
    closeModal();
    window.location.href = '/visualizations';
    return;
  }
  await addExistingViz(vizId);
}

function reloadDashboard(): void {
  window.location.href = buildDashboardUrl(state.dateRange);
}

// ── Date range stepper ───────────────────────────────────────────────────────

function buildDashboardUrl(range: DateRangeState): string {
  const params: string[] = [];
  if (state.dashboardId != null) params.push(`dashboard=${state.dashboardId}`);
  if (range.period !== 'all') params.push(`range=${encodeURIComponent(range.period)}`);
  if (range.period !== 'all' && range.period !== 'custom' && range.offset !== 0) {
    params.push(`offset=${range.offset}`);
  }
  if (range.period === 'custom') {
    if (range.customStart) params.push(`rs=${encodeURIComponent(range.customStart)}`);
    if (range.customEnd) params.push(`re=${encodeURIComponent(range.customEnd)}`);
  }
  return params.length === 0 ? '/visualizations' : `/visualizations?${params.join('&')}`;
}

function isStepperPeriod(period: DateRangePeriod): boolean {
  return period === 'week' || period === 'month' || period === 'quarter' || period === 'year';
}

function syncDateRangeRowUI(range: DateRangeState): void {
  const row = document.querySelector<HTMLElement>('[data-date-range-row]');
  if (!row) return;

  const periodSelect = row.querySelector<HTMLSelectElement>('[data-date-range-period]');
  if (periodSelect && periodSelect.value !== range.period) periodSelect.value = range.period;

  const stepper = row.querySelector<HTMLElement>('.date-range-stepper');
  if (stepper) stepper.hidden = !isStepperPeriod(range.period);

  const custom = row.querySelector<HTMLElement>('.date-range-custom');
  if (custom) custom.hidden = range.period !== 'custom';

  const startInput = row.querySelector<HTMLInputElement>('[data-date-range-custom-start]');
  if (startInput && document.activeElement !== startInput) {
    startInput.value = range.customStart ?? '';
  }
  const endInput = row.querySelector<HTMLInputElement>('[data-date-range-custom-end]');
  if (endInput && document.activeElement !== endInput) {
    endInput.value = range.customEnd ?? '';
  }
}

function buildWarningIndicator(
  warnings: string[],
  excludedEntitiesUrl: string | null
): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'warning-indicator';
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', 'Visualization warnings');

  const icon = document.createElement('span');
  icon.className = 'warning-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';
  wrap.appendChild(icon);

  const popover = document.createElement('span');
  popover.className = 'warning-popover';
  popover.setAttribute('role', 'tooltip');
  for (const text of warnings) {
    const p = document.createElement('p');
    p.className = 'warning';
    p.textContent = text;
    popover.appendChild(p);
  }
  if (excludedEntitiesUrl) {
    const p = document.createElement('p');
    p.className = 'warning';
    const a = document.createElement('a');
    a.className = 'warning-link';
    a.href = excludedEntitiesUrl;
    a.textContent = 'View excluded entities →';
    p.appendChild(a);
    popover.appendChild(p);
  }
  wrap.appendChild(popover);
  return wrap;
}

interface CardPayload {
  id: number;
  chartJsConfig: unknown;
  pointUrls: (string | null)[];
  smoothingPointUrls: (string | null)[] | null;
  smoothingDatasetIndex: number | null;
  warnings: string[];
  excludedEntityCount: number;
  excludedEntitiesUrl: string | null;
  layout: 'normal' | 'wide';
}

function applyCardUpdate(card: CardPayload): void {
  const cardEl = document.querySelector<HTMLElement>(
    `.dashboard-viz-card[data-viz-id="${card.id}"]`
  );
  if (!cardEl) return;

  cardEl.classList.toggle('dashboard-viz-card--wide', card.layout === 'wide');

  const existingWarning = cardEl.querySelector('.warning-indicator');
  existingWarning?.remove();
  if (card.warnings.length > 0) {
    const indicator = buildWarningIndicator(card.warnings, card.excludedEntitiesUrl);
    const editBtn = cardEl.querySelector('[data-edit-viz]');
    if (editBtn) {
      editBtn.before(indicator);
    } else {
      cardEl.querySelector('.dashboard-viz-card-header')?.appendChild(indicator);
    }
  }

  const canvas = cardEl.querySelector<HTMLCanvasElement>('canvas');
  if (canvas) {
    canvas.setAttribute('data-config', JSON.stringify(card.chartJsConfig));
    canvas.setAttribute('data-point-urls', JSON.stringify(card.pointUrls));
    canvas.setAttribute('data-smoothing-point-urls', JSON.stringify(card.smoothingPointUrls));
    canvas.setAttribute('data-smoothing-dataset-index', JSON.stringify(card.smoothingDatasetIndex));
    renderCardChart(canvas);
  }
}

// Sequence guards stale responses: if the user clicks the arrow several times
// in quick succession, only the latest fetch is allowed to mutate the DOM.
let rangeRequestSeq = 0;

async function applyRange(range: DateRangeState, opts: { pushHistory: boolean }): Promise<void> {
  state.dateRange = range;
  syncDateRangeRowUI(range);

  if (opts.pushHistory) {
    history.pushState({ dateRange: range }, '', buildDashboardUrl(range));
  }

  if (state.dashboardId == null) return;
  const seq = ++rangeRequestSeq;
  const apiUrl = buildDashboardCardsApiUrl(state.dashboardId, range);

  let resp: Response;
  try {
    resp = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  } catch {
    return;
  }
  if (seq !== rangeRequestSeq || !resp.ok) return;

  const data = (await resp.json()) as { cards: CardPayload[]; dateRangeLabel: string };
  if (seq !== rangeRequestSeq) return;

  const labelEl = document.querySelector<HTMLElement>('[data-date-range-label]');
  if (labelEl) labelEl.textContent = data.dateRangeLabel;

  for (const card of data.cards) applyCardUpdate(card);
}

function buildDashboardCardsApiUrl(dashboardId: number, range: DateRangeState): string {
  const params: string[] = [];
  if (range.period !== 'all') params.push(`range=${encodeURIComponent(range.period)}`);
  if (range.period !== 'all' && range.period !== 'custom' && range.offset !== 0) {
    params.push(`offset=${range.offset}`);
  }
  if (range.period === 'custom') {
    if (range.customStart) params.push(`rs=${encodeURIComponent(range.customStart)}`);
    if (range.customEnd) params.push(`re=${encodeURIComponent(range.customEnd)}`);
  }
  const query = params.length === 0 ? '' : `?${params.join('&')}`;
  return `/api/dashboards/${dashboardId}/cards${query}`;
}

function readRangeFromUrl(): DateRangeState {
  const params = new URLSearchParams(window.location.search);
  const rawPeriod = params.get('range');
  const validPeriods: DateRangePeriod[] = ['all', 'week', 'month', 'quarter', 'year', 'custom'];
  const period: DateRangePeriod = validPeriods.includes(rawPeriod as DateRangePeriod)
    ? (rawPeriod as DateRangePeriod)
    : 'all';
  const offsetN = parseInt(params.get('offset') ?? '0', 10);
  const offset = Number.isFinite(offsetN) ? offsetN : 0;
  const rs = params.get('rs');
  const re = params.get('re');
  const isIsoDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    period,
    offset,
    customStart: isIsoDate(rs) ? rs : null,
    customEnd: isIsoDate(re) ? re : null,
  };
}

function wireDateRange(): void {
  const row = document.querySelector<HTMLElement>('[data-date-range-row]');
  if (!row) return;

  const periodSelect = row.querySelector<HTMLSelectElement>('[data-date-range-period]');
  periodSelect?.addEventListener('change', () => {
    const period = periodSelect.value as DateRangePeriod;
    // Switching the period type always resets the stepper offset and clears
    // custom dates — picking a fresh granularity should land on the current
    // period, not carry over an offset that meant something else.
    const next: DateRangeState = {
      period,
      offset: 0,
      customStart: period === 'custom' ? state.dateRange.customStart : null,
      customEnd: period === 'custom' ? state.dateRange.customEnd : null,
    };
    void applyRange(next, { pushHistory: true });
  });

  const prevBtn = row.querySelector<HTMLButtonElement>('[data-date-range-prev]');
  prevBtn?.addEventListener('click', () => {
    void applyRange(
      { ...state.dateRange, offset: state.dateRange.offset - 1 },
      { pushHistory: true }
    );
  });

  const nextBtn = row.querySelector<HTMLButtonElement>('[data-date-range-next]');
  nextBtn?.addEventListener('click', () => {
    void applyRange(
      { ...state.dateRange, offset: state.dateRange.offset + 1 },
      { pushHistory: true }
    );
  });

  const startInput = row.querySelector<HTMLInputElement>('[data-date-range-custom-start]');
  const endInput = row.querySelector<HTMLInputElement>('[data-date-range-custom-end]');
  const applyCustom = (): void => {
    const customStart = startInput?.value ? startInput.value : null;
    const customEnd = endInput?.value ? endInput.value : null;
    // Don't fetch until at least one bound is set — saves an unbounded round-trip
    // on the very first focus into an empty date input.
    if (!customStart && !customEnd) return;
    void applyRange({ period: 'custom', offset: 0, customStart, customEnd }, { pushHistory: true });
  };
  startInput?.addEventListener('change', applyCustom);
  endInput?.addEventListener('change', applyCustom);

  window.addEventListener('popstate', () => {
    void applyRange(readRangeFromUrl(), { pushHistory: false });
  });
}

// ── Warning popover ──────────────────────────────────────────────────────────

const WARNING_HIDE_DELAY_MS = 500;
const warningHideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function showWarningPopover(indicator: HTMLElement): void {
  const pending = warningHideTimers.get(indicator);
  if (pending) {
    clearTimeout(pending);
    warningHideTimers.delete(indicator);
  }
  indicator.classList.add('is-visible');
}

function scheduleHideWarningPopover(indicator: HTMLElement): void {
  const pending = warningHideTimers.get(indicator);
  if (pending) clearTimeout(pending);
  warningHideTimers.set(
    indicator,
    setTimeout(() => {
      warningHideTimers.delete(indicator);
      indicator.classList.remove('is-visible');
    }, WARNING_HIDE_DELAY_MS)
  );
}

// Delegated so it keeps working for indicators rebuilt by buildWarningIndicator() after a
// card refresh. mouseover/mouseout (rather than mouseenter/mouseleave, which don't bubble)
// let a single listener on the grid cover every card's warning icon + popover as one unit.
function wireWarningPopovers(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;

  const movedWithinIndicator = (e: MouseEvent | FocusEvent, indicator: HTMLElement): boolean => {
    const related = e.relatedTarget as Node | null;
    return !!related && indicator.contains(related);
  };

  grid.addEventListener('mouseover', e => {
    const indicator = (e.target as HTMLElement).closest<HTMLElement>('.warning-indicator');
    if (indicator) showWarningPopover(indicator);
  });

  grid.addEventListener('mouseout', e => {
    const indicator = (e.target as HTMLElement).closest<HTMLElement>('.warning-indicator');
    if (indicator && !movedWithinIndicator(e, indicator)) scheduleHideWarningPopover(indicator);
  });

  grid.addEventListener('focusin', e => {
    const indicator = (e.target as HTMLElement).closest<HTMLElement>('.warning-indicator');
    if (indicator) showWarningPopover(indicator);
  });

  grid.addEventListener('focusout', e => {
    const indicator = (e.target as HTMLElement).closest<HTMLElement>('.warning-indicator');
    if (indicator && !movedWithinIndicator(e, indicator)) scheduleHideWarningPopover(indicator);
  });

  // The icon has no click behavior of its own — only the "View excluded entities" link
  // inside the popover should ever navigate.
  grid.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.warning-icon')) e.preventDefault();
  });
}

// ── Waymarks ─────────────────────────────────────────────────────────────────

type WaymarkAppliesTo = 'main' | 'smoothing';

interface WaymarkPayload {
  id: number;
  startDate: string;
  endDate: string;
  targetValue: number;
  appliesTo: WaymarkAppliesTo;
  label: string | null;
}

interface WaymarkModalState {
  vizId: number | null;
  waymarks: WaymarkPayload[];
  smoothingEnabled: boolean;
  editingId: number | null;
}

let waymarkModalState: WaymarkModalState = {
  vizId: null,
  waymarks: [],
  smoothingEnabled: false,
  editingId: null,
};

function getWaymarkModal(): HTMLDialogElement | null {
  return document.getElementById('waymark-modal') as HTMLDialogElement | null;
}

function closeWaymarkModal(): void {
  getWaymarkModal()?.close();
}

async function openWaymarkModal(vizId: number): Promise<void> {
  const dialog = getWaymarkModal();
  if (!dialog) return;
  waymarkModalState = { vizId, waymarks: [], smoothingEnabled: false, editingId: null };
  dialog.showModal();
  await refreshWaymarkList();
}

async function refreshWaymarkList(): Promise<void> {
  const vizId = waymarkModalState.vizId;
  if (vizId == null) return;
  const resp = await fetch(`/api/visualizations/${vizId}/waymarks`);
  if (!resp.ok) return;
  const data = (await resp.json()) as { waymarks: WaymarkPayload[]; smoothingEnabled: boolean };
  waymarkModalState.waymarks = data.waymarks;
  waymarkModalState.smoothingEnabled = data.smoothingEnabled;
  renderWaymarkModal();
}

function renderWaymarkModal(): void {
  const dialog = getWaymarkModal();
  if (!dialog) return;
  dialog.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'viz-modal-header';
  const title = document.createElement('h2');
  title.className = 'viz-modal-title';
  title.textContent = 'Waymarks';
  header.appendChild(title);
  dialog.appendChild(header);

  const body = document.createElement('div');
  body.className = 'viz-modal-body';
  body.appendChild(renderWaymarkList());
  body.appendChild(renderWaymarkForm());
  dialog.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'viz-modal-footer';
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  footer.appendChild(spacer);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'filter-btn';
  close.textContent = 'Close';
  close.addEventListener('click', closeWaymarkModal);
  footer.appendChild(close);
  dialog.appendChild(footer);
}

function renderWaymarkList(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'viz-modal-section';

  const heading = document.createElement('h3');
  heading.className = 'viz-modal-section-title';
  heading.textContent = 'Existing waymarks';
  section.appendChild(heading);

  if (waymarkModalState.waymarks.length === 0) {
    section.appendChild(sectionPlaceholder('No waymarks yet.'));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'waymark-list';
  for (const w of waymarkModalState.waymarks) {
    list.appendChild(renderWaymarkListItem(w));
  }
  section.appendChild(list);
  return section;
}

function renderWaymarkListItem(w: WaymarkPayload): HTMLElement {
  const item = document.createElement('li');
  item.className = 'waymark-list-item';

  const summary = document.createElement('span');
  summary.className = 'waymark-list-summary';
  const appliesText = w.appliesTo === 'smoothing' ? 'smoothing avg' : 'main line';
  summary.textContent = `${w.startDate} → ${w.endDate}: ${w.targetValue} (${appliesText})${
    w.label ? ` — ${w.label}` : ''
  }`;
  item.appendChild(summary);

  const actions = document.createElement('span');
  actions.className = 'waymark-list-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'filter-icon-btn';
  editBtn.title = 'Edit waymark';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => {
    waymarkModalState.editingId = w.id;
    renderWaymarkModal();
  });
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'filter-icon-btn';
  deleteBtn.title = 'Delete waymark';
  deleteBtn.textContent = '🗑';
  deleteBtn.addEventListener('click', () => void deleteWaymarkRow(w.id));
  actions.appendChild(deleteBtn);

  item.appendChild(actions);
  return item;
}

function waymarkField(
  labelText: string,
  type: string,
  name: string,
  value: string
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const lab = document.createElement('label');
  lab.className = 'filter-widget-label';
  lab.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.className = 'filter-input';
  input.value = value;
  if (type === 'number') input.step = 'any';
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return { wrap, input };
}

function renderWaymarkAppliesToField(current: WaymarkAppliesTo): {
  wrap: HTMLElement;
  select: HTMLSelectElement;
} {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const lab = document.createElement('label');
  lab.className = 'filter-widget-label';
  lab.textContent = 'Applies to';
  const select = document.createElement('select');
  select.name = 'applies_to';
  select.className = 'filter-select';
  select.appendChild(opt('main', 'Main line', current === 'main'));
  select.appendChild(opt('smoothing', 'Smoothing average', current === 'smoothing'));
  wrap.appendChild(lab);
  wrap.appendChild(select);
  return { wrap, select };
}

function renderWaymarkFormActions(editing: boolean): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'waymark-form-actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'filter-btn filter-btn-attention';
  submit.textContent = editing ? 'Save changes' : 'Add waymark';
  actions.appendChild(submit);

  if (editing) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'filter-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      waymarkModalState.editingId = null;
      renderWaymarkModal();
    });
    actions.appendChild(cancel);
  }
  return actions;
}

function renderWaymarkForm(): HTMLElement {
  const editing =
    waymarkModalState.waymarks.find(w => w.id === waymarkModalState.editingId) ?? null;

  const section = document.createElement('div');
  section.className = 'viz-modal-section';

  const heading = document.createElement('h3');
  heading.className = 'viz-modal-section-title';
  heading.textContent = editing ? 'Edit waymark' : 'Add waymark';
  section.appendChild(heading);

  const startField = waymarkField('Start date', 'date', 'start_date', editing?.startDate ?? '');
  const endField = waymarkField('End date', 'date', 'end_date', editing?.endDate ?? '');
  const targetField = waymarkField(
    'Target value',
    'number',
    'target_value',
    String(editing?.targetValue ?? '')
  );
  const labelField = waymarkField('Label (optional)', 'text', 'label', editing?.label ?? '');

  const form = document.createElement('form');
  form.className = 'viz-modal-fields';
  form.appendChild(startField.wrap);
  form.appendChild(endField.wrap);
  form.appendChild(targetField.wrap);

  let appliesToField: { wrap: HTMLElement; select: HTMLSelectElement } | null = null;
  if (waymarkModalState.smoothingEnabled) {
    appliesToField = renderWaymarkAppliesToField(editing?.appliesTo ?? 'main');
    form.appendChild(appliesToField.wrap);
  }

  form.appendChild(labelField.wrap);
  form.appendChild(renderWaymarkFormActions(!!editing));

  form.addEventListener('submit', e => {
    e.preventDefault();
    void submitWaymarkForm(
      startField.input.value,
      endField.input.value,
      targetField.input.value,
      appliesToField?.select.value ?? 'main',
      labelField.input.value
    );
  });

  section.appendChild(form);
  return section;
}

async function submitWaymarkForm(
  startDate: string,
  endDate: string,
  targetValueRaw: string,
  appliesToRaw: string,
  label: string
): Promise<void> {
  const vizId = waymarkModalState.vizId;
  if (vizId == null) return;
  const targetValue = Number(targetValueRaw);
  if (!startDate || !endDate || !isFinite(targetValue)) {
    alert('Start date, end date, and a numeric target value are required.');
    return;
  }

  const body = JSON.stringify({
    startDate,
    endDate,
    targetValue,
    appliesTo: appliesToRaw === 'smoothing' ? 'smoothing' : 'main',
    label: label.trim() ? label.trim() : null,
  });

  const editingId = waymarkModalState.editingId;
  const url =
    editingId != null ? `/api/waymarks/${editingId}` : `/api/visualizations/${vizId}/waymarks`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { error?: string };
    alert(err.error ?? 'Failed to save waymark.');
    return;
  }

  waymarkModalState.editingId = null;
  await refreshWaymarkList();
  await applyRange(state.dateRange, { pushHistory: false });
}

async function deleteWaymarkRow(id: number): Promise<void> {
  if (!confirm('Delete this waymark?')) return;
  const resp = await fetch(`/api/waymarks/${id}/delete`, { method: 'POST' });
  if (!resp.ok) return;
  await refreshWaymarkList();
  await applyRange(state.dateRange, { pushHistory: false });
}

function wireWaymarkButtons(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-waymark-viz]');
    if (!btn) return;
    const vizId = parseInt(btn.dataset.waymarkViz ?? '', 10);
    if (isNaN(vizId)) return;
    void openWaymarkModal(vizId);
  });
}

// ── Edit pencil ──────────────────────────────────────────────────────────────

function wireEditButtons(): void {
  const grid = document.querySelector<HTMLElement>('[data-viz-grid]');
  if (!grid) return;
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-edit-viz]');
    if (!btn) return;
    const vizId = parseInt(btn.dataset.editViz ?? '', 10);
    if (isNaN(vizId)) return;
    void openEditModal(vizId);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  hydrate();
  renderCardCharts();
  wireDashboardSelect();
  wireDashboardCombobox();
  wireNameInput();
  wireSaveChanges();
  wireDeleteConfirm();
  wireCreatePanel();
  wireAddVizSelect();
  wireRemoveButtons();
  wireEditButtons();
  wireWaymarkButtons();
  wireWarningPopovers();
  wireDragReorder();
  wireDateRange();
  recomputeDirty();
});
