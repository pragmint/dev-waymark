import type { FC } from 'hono/jsx';
import type { AvailableFilter, EntityWithMetadata } from '../../schemas/entity';
import type { FilterTree } from '../../schemas/filterTree';
import { Layout } from '../components/Layout';
import { FilterBar } from '../components/FilterBar';
import type { PresetWithUrl } from '../components/FilterBar';
import { buildEntityUrl } from '../../domain/filterUrl';
import { getEntityTitle, getMetadataValue } from '../../domain/entityQueries';

type EntitiesPageProps = {
  entities: EntityWithMetadata[];
  totalCount: number;
  page: number;
  perPage: number;
  activeTree: FilterTree;
  availableFilters: AvailableFilter[];
  metadataKeys: string[];
  entityTypes: string[];
  presets: PresetWithUrl[];
  selectedPresetId: number | null;
  selectedPresetTree: FilterTree | null;
  selectedEntityType: string | null;
  isDraft: boolean;
};

// Build a URL preserving the tree + active preset, swapping in a new page number.
function pageHref(
  page: number,
  perPage: number,
  activeTree: FilterTree,
  selectedPresetId: number | null
): string {
  const base = buildEntityUrl(activeTree, selectedPresetId);
  const url = new URL(base, 'http://x');
  if (page > 1) url.searchParams.set('page', String(page));
  if (perPage !== 50) url.searchParams.set('per_page', String(perPage));
  const qs = url.searchParams.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

export const EntitiesPage: FC<EntitiesPageProps> = ({
  entities,
  totalCount,
  page,
  perPage,
  activeTree,
  availableFilters,
  metadataKeys,
  entityTypes,
  presets,
  selectedPresetId,
  selectedPresetTree,
  selectedEntityType,
  isDraft,
}) => {
  const extraKeys = metadataKeys;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, totalCount);
  const noEntityTypes = entityTypes.length === 0;

  return (
    <Layout title="Entities" extraScripts={['/tableScroller.js', '/filters.js']}>
      <div class="page-header">
        <h1>Entities</h1>
        <span class="count" data-results-count>
          {totalCount === 0
            ? '0 results'
            : `${rangeStart}–${rangeEnd} of ${totalCount} result${totalCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      <FilterBar
        activeTree={activeTree}
        availableFilters={availableFilters}
        entityTypes={entityTypes}
        presets={presets}
        selectedPresetId={selectedPresetId}
        selectedPresetTree={selectedPresetTree}
        selectedEntityType={selectedEntityType}
        isDraft={isDraft}
      />

      <div data-results-region>
        {noEntityTypes ? (
          <p class="empty">No entity types found. Run a pipeline to populate data.</p>
        ) : entities.length === 0 ? (
          <p class="empty">No entities found. Adjust your filters or run a pipeline.</p>
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
                href={pageHref(page - 1, perPage, activeTree, selectedPresetId)}
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
                href={pageHref(page + 1, perPage, activeTree, selectedPresetId)}
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
      </div>
    </Layout>
  );
};
