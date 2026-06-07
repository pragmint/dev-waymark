import type { FC } from 'hono/jsx';
import type { Dataset } from '../../schemas/dataset';
import { TEMPLATES } from '../../schemas/visualizationTemplate';
import { Layout } from '../components/Layout';

type Props = {
  datasets: Dataset[];
  selectedDatasetId: number | null;
};

export const TemplatePickerPage: FC<Props> = ({ datasets, selectedDatasetId }) => {
  if (datasets.length === 0) {
    return (
      <Layout title="New Visualization">
        <div class="page-header">
          <h1>New Visualization</h1>
        </div>
        <p class="empty">
          No datasets yet. <a href="/datasets">Create one</a>.
        </p>
      </Layout>
    );
  }

  const dsId = selectedDatasetId ?? datasets[0].id;

  return (
    <Layout title="New Visualization" extraScripts={['/chartBuilder.js']}>
      <div class="page-header">
        <h1>New Visualization</h1>
      </div>

      <div style="margin-bottom:24px">
        <label
          class="filter-widget-label"
          for="dataset-picker"
          style="display:block;margin-bottom:6px"
        >
          Dataset
        </label>
        <select id="dataset-picker" class="filter-select" style="min-width:200px">
          {datasets.map(d => (
            <option key={d.id} value={d.id} selected={d.id === dsId}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div
        style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px"
        id="template-grid"
      >
        {TEMPLATES.map(t => (
          <a
            key={t.id}
            href={`/visualizations/new/${t.id}?dataset_id=${dsId}`}
            class="template-card"
            data-template-id={t.id}
          >
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-weight:600;font-size:14px">{t.name}</span>
              <span class="badge">{t.chartType}</span>
            </div>
            <p style="margin:0;font-size:13px;color:var(--color-muted);line-height:1.4">
              {t.description}
            </p>
          </a>
        ))}
      </div>
    </Layout>
  );
};
