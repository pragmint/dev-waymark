import type { FC } from 'hono/jsx';
import type { VisualizationSummary } from '../../schemas/visualization';
import { Layout } from '../components/Layout';

type Props = {
  visualizations: VisualizationSummary[];
  datasetMap: Map<number, string>;
};

export const VisualizationsPage: FC<Props> = ({ visualizations, datasetMap }) => (
  <Layout title="Visualizations">
    <div class="page-header">
      <h1>Visualizations</h1>
      <span class="count">
        {visualizations.length} visualization{visualizations.length !== 1 ? 's' : ''}
      </span>
      <div class="page-header-actions">
        <a href="/visualizations/new" class="filter-chip">
          New visualization
        </a>
      </div>
    </div>

    {visualizations.length === 0 ? (
      <p class="empty">
        No visualizations yet. <a href="/visualizations/new">Create one</a> from a saved dataset.
      </p>
    ) : (
      <table class="entity-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Chart type</th>
            <th>Dataset</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visualizations.map(v => (
            <tr key={v.id}>
              <td>
                <a href={`/visualizations/${v.id}`}>{v.name}</a>
              </td>
              <td>
                <span class="badge">{v.chartType}</span>
              </td>
              <td>{datasetMap.get(v.datasetId) ?? `Dataset ${v.datasetId}`}</td>
              <td style="text-align:right">
                <a href={`/visualizations/${v.id}/edit`} class="btn-text" style="margin-right:8px">
                  Edit
                </a>
                <form
                  method="post"
                  action={`/visualizations/${v.id}/delete`}
                  style="display:inline"
                >
                  <button type="submit" class="btn-text">
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Layout>
);
