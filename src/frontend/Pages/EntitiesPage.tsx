import type { FC } from 'hono/jsx';
import type { EntityFilters, EntityWithMetadata } from '../../schemas/entity';
import { Layout } from '../components/Layout';
import { FilterBar } from '../components/FilterBar';
import { formatDate } from '../../domain/parseDate';
import { getEntityTitle, getMetadataValue } from '../../domain/entityQueries';

type EntitiesPageProps = {
  entities: EntityWithMetadata[];
  filters: EntityFilters;
  sources: string[];
  types: string[];
};

export const EntitiesPage: FC<EntitiesPageProps> = ({ entities, filters, sources, types }) => (
  <Layout title="Entities">
    <div class="page-header">
      <h1>Entities</h1>
      <span class="count">
        {entities.length} result{entities.length !== 1 ? 's' : ''}
      </span>
    </div>

    <FilterBar filters={filters} sources={sources} types={types} />

    {entities.length === 0 ? (
      <p class="empty">No entities found. Run a pipeline to populate data.</p>
    ) : (
      <table class="entity-table">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Type</th>
            <th>Source</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {entities.map(e => (
            <tr>
              <td>
                <a href={`/entities/${e.id}`} class="entity-link">
                  {getEntityTitle(e)}
                </a>
              </td>
              <td>
                <span class="badge">{getMetadataValue(e, 'type') ?? '—'}</span>
              </td>
              <td>{getMetadataValue(e, 'source') ?? '—'}</td>
              <td>{formatDate(e.created_at)}</td>
              <td>{formatDate(e.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Layout>
);
