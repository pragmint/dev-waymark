import type { FC } from 'hono/jsx';
import type { MetaFilter, AvailableFilter, EntityWithMetadata } from '../../schemas/entity';
import { Layout } from '../components/Layout';
import { FilterBar } from '../components/FilterBar';
import { getEntityTitle, getMetadataValue } from '../../domain/entityQueries';

type EntitiesPageProps = {
  entities: EntityWithMetadata[];
  activeFilters: MetaFilter[];
  availableFilters: AvailableFilter[];
  addingKey?: string;
};

// Keys already shown as fixed columns — don't add a duplicate column for these
const FIXED_COLUMN_KEYS = new Set(['type', 'source']);

export const EntitiesPage: FC<EntitiesPageProps> = ({
  entities,
  activeFilters,
  availableFilters,
  addingKey,
}) => {
  const extraKeys = [...new Set(activeFilters.map(f => f.key))].filter(
    k => !FIXED_COLUMN_KEYS.has(k)
  );

  return (
    <Layout title="Entities">
      <div class="page-header">
        <h1>Entities</h1>
        <span class="count">
          {entities.length} result{entities.length !== 1 ? 's' : ''}
        </span>
      </div>

      <FilterBar
        activeFilters={activeFilters}
        availableFilters={availableFilters}
        addingKey={addingKey}
      />

      {entities.length === 0 ? (
        <p class="empty">No entities found. Run a pipeline to populate data.</p>
      ) : (
        <table class="entity-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Type</th>
              <th>Source</th>
              {extraKeys.map(k => (
                <th>{k}</th>
              ))}
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
                {extraKeys.map(k => (
                  <td>{getMetadataValue(e, k) ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
};
