import type { FC } from 'hono/jsx';
import type { Preset } from '../../schemas/preset';
import type { AvailableFilter } from '../../schemas/entity';
import type { Visualization } from '../../schemas/visualization';
import { Layout } from '../components/Layout';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

type Props = {
  presets: Preset[];
  selectedPresetId: number | null;
  selectedPresetName: string | null;
  availableFilters: AvailableFilter[];
  visualization: Visualization | null;
  errors: string[];
};

type FieldSelectProps = {
  name: string;
  id: string;
  allFields: AvailableFilter[];
  primaryType: 'date' | 'number' | 'string';
  noneLabel: string;
  selectedKey: string;
};

const FieldSelect: FC<FieldSelectProps> = ({
  name,
  id,
  allFields,
  primaryType,
  noneLabel,
  selectedKey,
}) => {
  const primary = allFields.filter(f => f.value_type === primaryType);
  const others = allFields.filter(f => f.value_type !== primaryType);
  return (
    <select
      name={name}
      id={id}
      class="filter-select"
      data-field-select={primaryType}
      data-none-label={noneLabel}
    >
      <option value="">{noneLabel}</option>
      {primary.map(f => (
        <option key={f.key} value={f.key} selected={selectedKey === f.key}>
          {f.key}
        </option>
      ))}
      {others.map(f => (
        <option key={f.key} value={f.key} selected={selectedKey === f.key}>
          {f.key} ({f.value_type})
        </option>
      ))}
    </select>
  );
};

export const ChartBuilderPage: FC<Props> = ({
  presets,
  selectedPresetId,
  selectedPresetName,
  availableFilters,
  visualization,
  errors,
}) => {
  const isEdit = visualization != null;
  const title = isEdit ? `Edit: ${visualization.name}` : 'New Visualization';
  const formAction = isEdit ? `/visualizations/${visualization.id}` : '/visualizations';
  const c = visualization?.config;

  // Derived state for SSR
  const measureType = c?.derivedMetric ? 'duration' : c?.yAxis ? 'field' : 'count';
  const hasTarget = c?.target != null;
  const targetType = c?.target?.type ?? 'horizontal_line';
  const chartType = c?.chartType ?? 'bar';
  const isCircular = chartType === 'pie' || chartType === 'doughnut';
  const aggFn = c?.aggregation.function ?? (measureType === 'count' ? 'count' : 'avg');

  if (!isEdit && presets.length === 0) {
    return (
      <Layout title="New Visualization">
        <div class="page-header">
          <h1>New Visualization</h1>
        </div>
        <div class="form-section">
          <p>
            No presets yet. <a href="/presets">Create one</a>.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={title} extraScripts={[CHART_JS_CDN, '/chartBuilder.js']}>
      <div class="page-header">
        <h1>{title}</h1>
      </div>

      {errors.length > 0 && (
        <div class="warning-box">
          {errors.map((e, i) => (
            <p key={i} class="warning">
              {e}
            </p>
          ))}
        </div>
      )}

      <div style="display:flex;gap:32px;align-items:flex-start">
        {/* Left: form */}
        <div style="flex:1;min-width:0">
          <form method="post" action={formAction} id="viz-builder-form">
            {/* ── Section 1: Name & Preset ── */}
            <div class="form-section">
              <h2 class="form-section-title">Name &amp; Preset</h2>
              <div class="form-field">
                <label class="filter-widget-label" for="name">
                  Name
                </label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  class="filter-input"
                  placeholder="e.g. Average Lead Time by Week"
                  value={c ? visualization!.name : ''}
                  required
                />
              </div>
              <div class="form-field">
                <label class="filter-widget-label" for="description">
                  Description
                </label>
                <input
                  type="text"
                  name="description"
                  id="description"
                  class="filter-input"
                  placeholder="Optional description"
                  value={visualization?.description ?? ''}
                />
              </div>
              <div class="form-field">
                <label class="filter-widget-label" for="preset_id">
                  Preset
                </label>
                {isEdit ? (
                  <>
                    <span>{selectedPresetName ?? `Preset ${visualization?.presetId}`}</span>
                    <input
                      type="hidden"
                      name="preset_id"
                      id="preset_id"
                      value={visualization?.presetId ?? ''}
                    />
                  </>
                ) : (
                  <select name="preset_id" id="preset_id" class="filter-select">
                    {presets.map(d => (
                      <option key={d.id} value={d.id} selected={d.id === selectedPresetId}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* ── Section 2: Group by ── */}
            <div class="form-section">
              <h2 class="form-section-title">Group by</h2>

              {/* Over time row */}
              <div
                id="section-time-series"
                class="form-field"
                style={isCircular ? 'display:none' : ''}
              >
                <label class="filter-widget-label">Over time</label>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <FieldSelect
                    name="x_axis_key"
                    id="x_axis_key"
                    allFields={availableFilters}
                    primaryType="date"
                    noneLabel="— none —"
                    selectedKey={c?.xAxis?.metadataKey ?? ''}
                  />
                  <input type="hidden" name="x_axis_type" value={c?.xAxis?.type ?? 'date'} />
                  <select name="x_axis_time_bucket" id="x_axis_time_bucket" class="filter-select">
                    <option value="">— bucket —</option>
                    {(['day', 'week', 'month', 'quarter', 'year'] as const).map(b => (
                      <option key={b} value={b} selected={(c?.xAxis?.timeBucket ?? '') === b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* By category row */}
              <div id="section-categorical" class="form-field">
                <label class="filter-widget-label">By category</label>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <FieldSelect
                    name="category_key"
                    id="category_key"
                    allFields={availableFilters}
                    primaryType="string"
                    noneLabel="— none —"
                    selectedKey={c?.category?.metadataKey ?? ''}
                  />
                  <select name="category_sort_by" id="category_sort_by" class="filter-select">
                    {(
                      [
                        ['value_desc', 'Value ↓'],
                        ['value_asc', 'Value ↑'],
                        ['label_asc', 'Label A→Z'],
                        ['label_desc', 'Label Z→A'],
                      ] as const
                    ).map(([val, lbl]) => (
                      <option
                        key={val}
                        value={val}
                        selected={(c?.category?.sortBy ?? 'value_desc') === val}
                      >
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Section 3: Measure ── */}
            <div class="form-section">
              <h2 class="form-section-title">Measure</h2>

              {/* Radio buttons — JS-only UI drivers, not submitted */}
              <div class="form-field" style="gap:16px">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                  <input
                    type="radio"
                    name="measure_type"
                    value="count"
                    checked={measureType === 'count'}
                  />{' '}
                  Count
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                  <input
                    type="radio"
                    name="measure_type"
                    value="field"
                    checked={measureType === 'field'}
                  />{' '}
                  Field value
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                  <input
                    type="radio"
                    name="measure_type"
                    value="duration"
                    checked={measureType === 'duration'}
                  />{' '}
                  Duration
                </label>
              </div>

              {/* Hidden aggregation_fn submitted with form */}
              <input type="hidden" name="aggregation_fn" id="aggregation_fn" value={aggFn} />

              {/* Hidden checkbox for derived metric enabled */}
              <input
                type="checkbox"
                name="derived_metric_enabled"
                id="derived_metric_enabled"
                checked={measureType === 'duration'}
                style="display:none"
              />

              {/* Field measure section */}
              <div id="measure-field" style={measureType !== 'field' ? 'display:none' : ''}>
                <div class="form-field">
                  <label class="filter-widget-label" for="y_axis_key">
                    Numeric field
                  </label>
                  <FieldSelect
                    name="y_axis_key"
                    id="y_axis_key"
                    allFields={availableFilters}
                    primaryType="number"
                    noneLabel="— none —"
                    selectedKey={c?.yAxis?.metadataKey ?? ''}
                  />
                  <input type="hidden" name="y_axis_type" value="number" />
                </div>
                {/* Unit conversion collapsible */}
                <div class="form-field">
                  <button type="button" id="unit-conversion-toggle" class="btn-text">
                    + Unit conversion
                  </button>
                </div>
                <div id="unit-conversion" style="display:none">
                  <div class="form-field">
                    <label class="filter-widget-label" for="y_axis_unit">
                      Storage unit
                    </label>
                    <select name="y_axis_unit" id="y_axis_unit" class="filter-select">
                      <option value="">— none —</option>
                      {(['seconds', 'minutes', 'hours', 'days', 'weeks'] as const).map(u => (
                        <option key={u} value={u} selected={(c?.yAxis?.unit ?? '') === u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="form-field">
                    <label class="filter-widget-label" for="y_axis_display_unit">
                      Display unit
                    </label>
                    <select
                      name="y_axis_display_unit"
                      id="y_axis_display_unit"
                      class="filter-select"
                    >
                      <option value="">— same as storage —</option>
                      {(['seconds', 'minutes', 'hours', 'days', 'weeks'] as const).map(u => (
                        <option key={u} value={u} selected={(c?.yAxis?.displayUnit ?? '') === u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Duration measure section */}
              <div id="measure-duration" style={measureType !== 'duration' ? 'display:none' : ''}>
                <div class="form-field">
                  <span class="filter-widget-label">From / To / Unit</span>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <span>From</span>
                    <FieldSelect
                      name="derived_metric_start_key"
                      id="derived_metric_start_key"
                      allFields={availableFilters}
                      primaryType="date"
                      noneLabel="— start —"
                      selectedKey={c?.derivedMetric?.startMetadataKey ?? ''}
                    />
                    <span>to</span>
                    <FieldSelect
                      name="derived_metric_end_key"
                      id="derived_metric_end_key"
                      allFields={availableFilters}
                      primaryType="date"
                      noneLabel="— end —"
                      selectedKey={c?.derivedMetric?.endMetadataKey ?? ''}
                    />
                    <span>in</span>
                    <select
                      name="derived_metric_unit"
                      id="derived_metric_unit"
                      class="filter-select"
                    >
                      {(['seconds', 'minutes', 'hours', 'days', 'weeks'] as const).map(u => (
                        <option
                          key={u}
                          value={u}
                          selected={(c?.derivedMetric?.unit ?? 'seconds') === u}
                        >
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div class="form-field">
                  <label class="filter-widget-label" for="derived_metric_name">
                    Metric name
                  </label>
                  <input
                    type="text"
                    name="derived_metric_name"
                    id="derived_metric_name"
                    class="filter-input"
                    placeholder="e.g. lead_time"
                    value={c?.derivedMetric?.name ?? ''}
                  />
                </div>
              </div>

              {/* Aggregation select (hidden for count) */}
              <div id="measure-aggregation" style={measureType === 'count' ? 'display:none' : ''}>
                <div class="form-field">
                  <label class="filter-widget-label" for="aggregation_fn_ui">
                    Aggregation
                  </label>
                  <select id="aggregation_fn_ui" class="filter-select">
                    {(
                      [
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
                      ] as const
                    ).map(([val, lbl]) => (
                      <option key={val} value={val} selected={aggFn === val}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Section 4: Chart type ── */}
            <div class="form-section">
              <h2 class="form-section-title">Chart type</h2>
              <div class="form-field" style="display:flex;gap:8px;flex-wrap:wrap">
                {(['bar', 'line', 'pie', 'doughnut'] as const).map(t => (
                  <label
                    key={t}
                    style="display:flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer"
                  >
                    <input type="radio" name="chart_type" value={t} checked={chartType === t} />{' '}
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            {/* ── Section 5: Reference line ── */}
            <div class="form-section">
              <h2 class="form-section-title">Reference line</h2>
              <div class="form-field" style="display:flex;gap:8px;align-items:center">
                <button type="button" id="target-add-btn" class="btn-text">
                  + Add
                </button>
                <button
                  type="button"
                  id="target-remove-btn"
                  class="btn-text"
                  style={hasTarget ? '' : 'display:none'}
                >
                  Remove
                </button>
              </div>
              <input
                type="checkbox"
                name="target_enabled"
                id="target_enabled"
                checked={hasTarget}
                style="display:none"
              />
              <div id="target-fields" style={hasTarget ? '' : 'display:none'}>
                <div
                  class="form-field"
                  style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"
                >
                  <select name="target_type" id="target_type" class="filter-select">
                    <option value="horizontal_line" selected={targetType === 'horizontal_line'}>
                      Horizontal line
                    </option>
                    <option value="vertical_line" selected={targetType === 'vertical_line'}>
                      Vertical line
                    </option>
                    <option value="band" selected={targetType === 'band'}>
                      Band
                    </option>
                  </select>
                  <input
                    type="text"
                    name="target_label"
                    id="target_label"
                    class="filter-input"
                    placeholder="Label (optional)"
                    value={c?.target?.label ?? ''}
                    style="max-width:200px"
                  />
                  <span
                    id="target-horizontal-fields"
                    style={targetType === 'horizontal_line' ? '' : 'display:none'}
                  >
                    <input
                      type="number"
                      name="target_value"
                      id="target_value"
                      class="filter-input"
                      step="any"
                      placeholder="Value"
                      value={c?.target?.type === 'horizontal_line' ? String(c.target.value) : ''}
                      style="max-width:120px"
                    />
                  </span>
                  <span
                    id="target-vertical-fields"
                    style={targetType === 'vertical_line' ? '' : 'display:none'}
                  >
                    <input
                      type="text"
                      name="target_value_str"
                      id="target_value_str"
                      class="filter-input"
                      placeholder="2026-05-01"
                      value={c?.target?.type === 'vertical_line' ? c.target.value : ''}
                      style="max-width:160px"
                    />
                  </span>
                  <span id="target-band-fields" style={targetType === 'band' ? '' : 'display:none'}>
                    <input
                      type="number"
                      name="target_min"
                      id="target_min"
                      class="filter-input"
                      step="any"
                      placeholder="Min"
                      value={c?.target?.type === 'band' ? String(c.target.min) : ''}
                      style="max-width:100px"
                    />
                    <input
                      type="number"
                      name="target_max"
                      id="target_max"
                      class="filter-input"
                      step="any"
                      placeholder="Max"
                      value={c?.target?.type === 'band' ? String(c.target.max) : ''}
                      style="max-width:100px"
                    />
                  </span>
                </div>
              </div>
            </div>

            {/* ── Section 6: Actions ── */}
            <div class="form-section form-actions">
              <button type="submit" class="filter-btn">
                {isEdit ? 'Save changes' : 'Save visualization'}
              </button>
              <a
                href={isEdit ? `/visualizations/${visualization.id}` : '/visualizations'}
                class="btn-text"
                style="margin-left:8px"
              >
                Cancel
              </a>
            </div>
          </form>
        </div>

        {/* Right: preview pane */}
        <div style="width:440px;flex-shrink:0;position:sticky;top:24px">
          <h2 class="form-section-title">Preview</h2>
          <div id="preview-status" style="font-size:0.85rem;color:#6b7280;min-height:18px" />
          <div id="preview-warnings" />
          <div style="position:relative">
            <canvas id="preview-chart" style="max-height:400px" />
          </div>
        </div>
      </div>
    </Layout>
  );
};
