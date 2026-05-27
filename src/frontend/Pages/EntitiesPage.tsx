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

// Keys that don't need an extra column: fixed metadata columns already shown, and entity_name
// which is a pseudo-metadata key that maps to the Entity column
const FIXED_COLUMN_KEYS = new Set(['entity_type', 'entity_created_at', 'source', 'entity_name']);

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
        <div class="page-header-actions">
          <button type="button" id="save-dataset-btn" class="filter-chip">
            Save dataset
          </button>
        </div>
      </div>

      <div id="save-dataset-panel" class="save-dataset-panel" style="display:none">
        <form method="post" action="/datasets" class="save-dataset-form">
          {activeFilters.map(f => (
            <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
          ))}
          <span class="filter-widget-label">Name</span>
          <input
            type="text"
            name="name"
            class="filter-input"
            placeholder="Dataset name…"
            required
          />
          <button type="submit" class="filter-btn">
            Save
          </button>
          <button type="button" id="save-dataset-cancel" class="btn-text">
            Cancel
          </button>
        </form>
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
                  <span class="badge">{e.type || '—'}</span>
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
