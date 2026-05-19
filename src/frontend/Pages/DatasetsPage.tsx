import type { FC } from 'hono/jsx';
import type { Dataset } from '../../schemas/dataset';
import { Layout } from '../components/Layout';

type DatasetWithUrl = Dataset & { url: string };

type DatasetsPageProps = {
  datasets: DatasetWithUrl[];
};

export const DatasetsPage: FC<DatasetsPageProps> = ({ datasets }) => (
  <Layout title="Saved Datasets">
    <div class="page-header">
      <h1>Saved Datasets</h1>
      <span class="count">
        {datasets.length} dataset{datasets.length !== 1 ? 's' : ''}
      </span>
    </div>

    {datasets.length === 0 ? (
      <p class="empty">
        No saved datasets yet. Apply filters on the <a href="/entities">Entities</a> page and save
        them.
      </p>
    ) : (
      <table class="entity-table">
        <thead>
          <tr>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {datasets.map(d => (
            <tr>
              <td>
                <a href={d.url}>{d.name}</a>
              </td>
              <td style="text-align:right">
                <form method="post" action={`/datasets/${d.id}/delete`}>
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
