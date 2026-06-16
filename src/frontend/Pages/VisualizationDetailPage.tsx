import type { FC } from 'hono/jsx';
import type { Visualization } from '../../schemas/visualization';
import type { ChartDataResult, ChartJsConfig } from '../../domain/chartDataBuilder';
import { Layout } from '../components/Layout';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';

type Props = {
  visualization: Visualization;
  presetName: string;
  presetUrl: string;
  chartResult: ChartDataResult;
  chartJsConfig: ChartJsConfig;
  pointUrls: string[];
};

export const VisualizationDetailPage: FC<Props> = ({
  visualization,
  presetName,
  presetUrl,
  chartResult,
  chartJsConfig,
  pointUrls,
}) => {
  const configJson = JSON.stringify(chartJsConfig);
  const pointUrlsJson = JSON.stringify(pointUrls);

  return (
    <Layout title={visualization.name} extraScripts={[CHART_JS_CDN, '/chartBuilder.js']}>
      <div class="page-header">
        <h1>{visualization.name}</h1>
        <div class="page-header-actions">
          <a href={`/visualizations/${visualization.id}/edit`} class="filter-chip">
            Edit
          </a>
          <form
            method="post"
            action={`/visualizations/${visualization.id}/delete`}
            style="display:inline"
          >
            <button type="submit" class="btn-text" style="margin-left:8px">
              Delete
            </button>
          </form>
        </div>
      </div>

      {visualization.description && <p class="entity-description">{visualization.description}</p>}

      <div class="metadata-row">
        <span class="metadata-label">Preset</span>
        <a href={presetUrl}>{presetName}</a>
        <span class="metadata-label">Chart type</span>
        <span class="badge">{visualization.config.chartType}</span>
      </div>

      {chartResult.warnings.length > 0 && (
        <div class="warning-box">
          {chartResult.warnings.map((w, i) => (
            <p key={i} class="warning">
              {w}
            </p>
          ))}
        </div>
      )}

      <div class="chart-container" style="position:relative; max-width:900px; margin-top:24px">
        <canvas
          id="main-chart"
          data-config={configJson}
          data-point-urls={pointUrlsJson}
          style="max-height:500px"
        />
      </div>

      <div style="margin-top:16px; font-size:0.85rem; color:#6b7280">
        {chartResult.excludedEntityCount > 0 && (
          <p>
            {chartResult.excludedEntityCount} entit
            {chartResult.excludedEntityCount === 1 ? 'y' : 'ies'} had missing fields and were
            excluded.
          </p>
        )}
        <p>
          <a href="/visualizations">← All visualizations</a>
        </p>
      </div>
    </Layout>
  );
};
