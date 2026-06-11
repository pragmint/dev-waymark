import type { FC } from 'hono/jsx';
import type { MetaFilter, AvailableFilter, EntityWithMetadata } from '../../schemas/entity';
import { Layout } from '../components/Layout';
import { FilterBar } from '../components/FilterBar';
import { getEntityTitle, getMetadataValue } from '../../domain/entityQueries';

type EntitiesPageProps = {
  entities: EntityWithMetadata[];
  totalCount: number;
  page: number;
  perPage: number;
  activeFilters: MetaFilter[];
  availableFilters: AvailableFilter[];
  addingKey?: string;
  editingKey?: string;
};

// Build a URL preserving filters + add/edit keys, swapping in a new page number.
function pageHref(
  page: number,
  perPage: number,
  activeFilters: MetaFilter[],
  addingKey?: string,
  editingKey?: string
): string {
  const params = new URLSearchParams();
  for (const f of activeFilters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  if (addingKey) params.set('add_filter', addingKey);
  if (editingKey) params.set('edit_filter', editingKey);
  if (page > 1) params.set('page', String(page));
  if (perPage !== 50) params.set('per_page', String(perPage));
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

export const EntitiesPage: FC<EntitiesPageProps> = ({
  entities,
  totalCount,
  page,
  perPage,
  activeFilters,
  availableFilters,
  addingKey,
  editingKey,
}) => {
  const hasEntityTypeFilter = activeFilters.some(f => f.key === 'entity_type');
  const extraKeys = hasEntityTypeFilter
    ? [...new Set(availableFilters.filter(f => f.entityType !== '').map(f => f.key))]
    : [];
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, totalCount);

  return (
    <Layout title="Entities" extraScripts={['/tableScroller.js']}>
      <div class="page-header">
        <h1>Entities</h1>
        <span class="count">
          {totalCount === 0
            ? '0 results'
            : `${rangeStart}–${rangeEnd} of ${totalCount} result${totalCount !== 1 ? 's' : ''}`}
        </span>
        <div class="page-header-actions">
          <button type="button" id="save-preset-btn" class="filter-chip">
            Save preset
          </button>
        </div>
      </div>

      <div id="save-preset-panel" class="save-preset-panel" style="display:none">
        <form method="post" action="/presets" class="save-preset-form">
          {activeFilters.map(f => (
            <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
          ))}
          <span class="filter-widget-label">Name</span>
          <input type="text" name="name" class="filter-input" placeholder="Preset name…" required />
          <button type="submit" class="filter-btn">
            Save
          </button>
          <button type="button" id="save-preset-cancel" class="btn-text">
            Cancel
          </button>
        </form>
      </div>

      <FilterBar
        activeFilters={activeFilters}
        availableFilters={availableFilters}
        addingKey={addingKey}
        editingKey={editingKey}
      />

      {!hasEntityTypeFilter ? (
        <p class="empty">Select an entity type filter to view entities and their metadata.</p>
      ) : entities.length === 0 ? (
        <p class="empty">No entities found. Run a pipeline to populate data.</p>
      ) : (
        <div class="table-scroll-wrap" data-table-scroll-wrap>
          <div class="table-scroll-rail table-scroll-rail--left">
            <button
              type="button"
              class="table-scroll-btn"
              data-table-scroll="left"
              aria-label="Scroll columns left"
            >
              ‹
            </button>
          </div>
          <div class="table-scroll-rail table-scroll-rail--right">
            <button
              type="button"
              class="table-scroll-btn"
              data-table-scroll="right"
              aria-label="Scroll columns right"
            >
              ›
            </button>
          </div>
          <div class="table-scroll" data-table-scroll-container>
            <table class="entity-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Type</th>
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
                    {extraKeys.map(k => (
                      <td>{getMetadataValue(e, k) ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav class="pagination" data-pagination aria-label="Pagination">
          {hasPrev ? (
            <a
              class="pagination-link"
              data-pagination-prev
              href={pageHref(page - 1, perPage, activeFilters, addingKey, editingKey)}
            >
              ← Prev
            </a>
          ) : (
            <span class="pagination-link pagination-link--disabled" data-pagination-prev>
              ← Prev
            </span>
          )}
          <span class="pagination-status" data-pagination-status>
            Page {page} of {totalPages}
          </span>
          {hasNext ? (
            <a
              class="pagination-link"
              data-pagination-next
              href={pageHref(page + 1, perPage, activeFilters, addingKey, editingKey)}
            >
              Next →
            </a>
          ) : (
            <span class="pagination-link pagination-link--disabled" data-pagination-next>
              Next →
            </span>
          )}
        </nav>
      )}
    </Layout>
  );
};
