import type { FC } from 'hono/jsx';
import type { AvailableFilter } from '../../schemas/entity';
import type { TemplateId } from '../../schemas/visualizationTemplate';
import type { Visualization } from '../../schemas/visualization';
import { TEMPLATES } from '../../schemas/visualizationTemplate';
import { Layout } from '../components/Layout';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

type Props = {
  templateId: TemplateId;
  datasetId: number;
  datasetName: string;
  availableFilters: AvailableFilter[];
  visualization: Visualization | null;
  errors: string[];
};

type FieldSelectProps = {
  name: string;
  id: string;
  allFields: AvailableFilter[];
  primaryType: 'date' | 'number' | 'string';
  label: string;
  selectedKey: string;
};

const FieldSelect: FC<FieldSelectProps> = ({
  name,
  id,
  allFields,
  primaryType,
  label,
  selectedKey,
}) => {
  const primary = allFields.filter(f => f.value_type === primaryType);
  const others = allFields.filter(f => f.value_type !== primaryType);
  return (
    <div class="form-field">
      <label class="filter-widget-label" for={id}>
        {label}
      </label>
      <select name={name} id={id} class="filter-select" data-field-select={primaryType}>
        <option value="">-- select --</option>
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
    </div>
  );
};

const TimeBucketSelect: FC<{ selected: string }> = ({ selected }) => (
  <div class="form-field">
    <label class="filter-widget-label" for="time_bucket">
      Time bucket
    </label>
    <select name="time_bucket" id="time_bucket" class="filter-select">
      {(['day', 'week', 'month', 'quarter', 'year'] as const).map(b => (
        <option key={b} value={b} selected={selected === b}>
          {b}
        </option>
      ))}
    </select>
  </div>
);

const AggregationSelect: FC<{ selected: string }> = ({ selected }) => (
  <div class="form-field">
    <label class="filter-widget-label" for="aggregation">
      Aggregation
    </label>
    <select name="aggregation" id="aggregation" class="filter-select">
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
        <option key={val} value={val} selected={selected === val}>
          {lbl}
        </option>
      ))}
    </select>
  </div>
);

const UnitSelect: FC<{ selected: string }> = ({ selected }) => (
  <div class="form-field">
    <label class="filter-widget-label" for="unit">
      Unit
    </label>
    <select name="unit" id="unit" class="filter-select">
      {(['seconds', 'minutes', 'hours', 'days', 'weeks'] as const).map(u => (
        <option key={u} value={u} selected={selected === u}>
          {u}
        </option>
      ))}
    </select>
  </div>
);

function getSlotValue(visualization: Visualization | null, path: string): string {
  if (!visualization) return '';
  const tc = visualization.config._templateConfig;
  if (!tc) return '';
  const slots = tc.slots as Record<string, string>;
  return slots[path] ?? '';
}

export const TemplateConfigPage: FC<Props> = ({
  templateId,
  datasetId,
  datasetName,
  availableFilters,
  visualization,
  errors,
}) => {
  const template = TEMPLATES.find(t => t.id === templateId)!;
  const isEdit = visualization != null;
  const title = isEdit ? `Edit: ${visualization.name}` : `New: ${template.name}`;
  const formAction = isEdit ? `/visualizations/${visualization.id}` : '/visualizations';

  const sv = (key: string) => getSlotValue(visualization, key);

  return (
    <Layout title={title} extraScripts={[CHART_JS_CDN, '/chartBuilder.js']}>
      <div class="page-header">
        <h1>{title}</h1>
      </div>

      {!isEdit && (
        <p style="margin:0 0 16px;font-size:13px;color:var(--color-muted)">
          {template.description}
        </p>
      )}

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
        <div style="flex:1;min-width:0">
          <form method="post" action={formAction} id="template-config-form">
            <input type="hidden" name="template_id" value={templateId} />
            <input type="hidden" name="dataset_id" value={datasetId} />

            <div class="form-section">
              <div class="form-field">
                <label class="filter-widget-label" for="name">
                  Name
                </label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  class="filter-input"
                  placeholder={`e.g. ${template.name}`}
                  value={visualization?.name ?? ''}
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
                  placeholder="Optional"
                  value={visualization?.description ?? ''}
                />
              </div>
              <div class="form-field">
                <span class="filter-widget-label">Dataset</span>
                <span style="font-size:13px">{datasetName}</span>
              </div>
            </div>

            <div class="form-section">
              <h2 class="form-section-title">Configure</h2>
              <TemplateSlots templateId={templateId} availableFilters={availableFilters} sv={sv} />
            </div>

            <div class="form-actions">
              <button type="submit" class="filter-btn">
                {isEdit ? 'Save changes' : 'Save visualization'}
              </button>
              <a
                href={isEdit ? `/visualizations/${visualization.id}` : '/visualizations/new'}
                class="btn-text"
              >
                Cancel
              </a>
            </div>
          </form>
        </div>

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

const TemplateSlots: FC<{
  templateId: TemplateId;
  availableFilters: AvailableFilter[];
  sv: (key: string) => string;
}> = ({ templateId, availableFilters, sv }) => {
  switch (templateId) {
    case 'duration_trend':
      return (
        <>
          <FieldSelect
            name="start_date_field"
            id="start_date_field"
            allFields={availableFilters}
            primaryType="date"
            label="Start date field"
            selectedKey={sv('startDateField')}
          />
          <FieldSelect
            name="end_date_field"
            id="end_date_field"
            allFields={availableFilters}
            primaryType="date"
            label="End date field"
            selectedKey={sv('endDateField')}
          />
          <TimeBucketSelect selected={sv('timeBucket') || 'week'} />
          <UnitSelect selected={sv('unit') || 'days'} />
        </>
      );
    case 'category_breakdown':
      return (
        <FieldSelect
          name="category_field"
          id="category_field"
          allFields={availableFilters}
          primaryType="string"
          label="Category field"
          selectedKey={sv('categoryField')}
        />
      );
    case 'phase_snapshot':
      return (
        <>
          <FieldSelect
            name="category_field"
            id="category_field"
            allFields={availableFilters}
            primaryType="string"
            label="Phase / category field"
            selectedKey={sv('categoryField')}
          />
          <FieldSelect
            name="date_field"
            id="date_field"
            allFields={availableFilters}
            primaryType="date"
            label="Date field"
            selectedKey={sv('dateField')}
          />
        </>
      );
    case 'throughput_over_time':
      return (
        <>
          <FieldSelect
            name="date_field"
            id="date_field"
            allFields={availableFilters}
            primaryType="date"
            label="Date field"
            selectedKey={sv('dateField')}
          />
          <TimeBucketSelect selected={sv('timeBucket') || 'week'} />
        </>
      );
    case 'field_trend':
      return (
        <>
          <FieldSelect
            name="date_field"
            id="date_field"
            allFields={availableFilters}
            primaryType="date"
            label="Date field"
            selectedKey={sv('dateField')}
          />
          <FieldSelect
            name="numeric_field"
            id="numeric_field"
            allFields={availableFilters}
            primaryType="number"
            label="Numeric field"
            selectedKey={sv('numericField')}
          />
          <TimeBucketSelect selected={sv('timeBucket') || 'week'} />
          <AggregationSelect selected={sv('aggregation') || 'avg'} />
        </>
      );
    case 'category_comparison':
      return (
        <>
          <FieldSelect
            name="category_field"
            id="category_field"
            allFields={availableFilters}
            primaryType="string"
            label="Category field"
            selectedKey={sv('categoryField')}
          />
          <FieldSelect
            name="numeric_field"
            id="numeric_field"
            allFields={availableFilters}
            primaryType="number"
            label="Numeric field"
            selectedKey={sv('numericField')}
          />
          <AggregationSelect selected={sv('aggregation') || 'avg'} />
        </>
      );
  }
};
