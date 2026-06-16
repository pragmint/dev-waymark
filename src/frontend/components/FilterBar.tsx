import type { FC } from 'hono/jsx';
import type { MetaFilter, AvailableFilter } from '../../schemas/entity';
import type { Preset } from '../../schemas/preset';
import { buildEntityUrl, metaFiltersEqual } from '../../domain/filterUrl';

type FilterBarProps = {
  activeFilters: MetaFilter[];
  availableFilters: AvailableFilter[];
  addingKey?: string;
  editingKey?: string;
  entityTypes: string[];
  presets: PresetWithUrl[];
  selectedPresetId: number | null;
  selectedPresetFilters: MetaFilter[] | null;
  selectedEntityType: string | null;
  isDraft: boolean;
};

export type PresetWithUrl = Preset & { url: string };

function formatValueType(type: string): string {
  const typeMap: Record<string, string> = {
    string: 'Text',
    number: 'Number',
    date: 'Date',
    boolean: 'Boolean',
  };
  return typeMap[type] || type;
}

function formatFieldLabel(key: string): string {
  // Convert snake_case to Title Case
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function withPreset(params: URLSearchParams, presetId: number | null): URLSearchParams {
  if (presetId != null) params.set('preset', String(presetId));
  return params;
}

function removeFilterUrl(
  activeFilters: MetaFilter[],
  removeKey: string,
  presetId: number | null
): string {
  const params = withPreset(new URLSearchParams(), presetId);
  for (const f of activeFilters) {
    if (f.key === removeKey) continue;
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  return `/entities${qs ? '?' + qs : ''}`;
}

function editFilterUrl(
  activeFilters: MetaFilter[],
  editKey: string,
  presetId: number | null
): string {
  const params = withPreset(new URLSearchParams(), presetId);
  for (const f of activeFilters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  params.set('edit_filter', editKey);
  return `/entities?${params.toString()}`;
}

function chipLabel(filters: MetaFilter[]): string {
  const gte = filters.find(f => f.op === 'gte');
  const lte = filters.find(f => f.op === 'lte');
  if (gte && lte) return `${gte.value} – ${lte.value}`;
  if (gte) return `≥ ${gte.value}`;
  if (lte) return `≤ ${lte.value}`;
  const re = filters.find(f => f.op === 're');
  if (re) return `/${re.value}/`;
  const eqValues = filters.filter(f => f.op === 'eq').map(f => f.value);
  if (eqValues.length > 0) return eqValues.join(', ');
  const contains = filters.find(f => f.op === 'contains');
  if (contains) return `~${contains.value}`;
  return filters[0]?.value ?? '';
}

function renderWidget(f: AvailableFilter, isOpen: boolean, currentFilters: MetaFilter[]) {
  const dis = !isOpen;
  const findVal = (op: MetaFilter['op']) => currentFilters.find(cf => cf.op === op)?.value ?? '';

  if (f.value_type === 'date') {
    return (
      <>
        <input
          type="date"
          name={`mf__${f.key}__gte`}
          class="filter-input"
          value={findVal('gte')}
          disabled={dis}
        />
        <span class="filter-sep">–</span>
        <input
          type="date"
          name={`mf__${f.key}__lte`}
          class="filter-input"
          value={findVal('lte')}
          disabled={dis}
        />
      </>
    );
  }

  if (f.value_type === 'number') {
    return (
      <>
        <input
          type="number"
          name={`mf__${f.key}__gte`}
          class="filter-input filter-input-sm"
          placeholder="min"
          value={findVal('gte')}
          disabled={dis}
        />
        <span class="filter-sep">–</span>
        <input
          type="number"
          name={`mf__${f.key}__lte`}
          class="filter-input filter-input-sm"
          placeholder="max"
          value={findVal('lte')}
          disabled={dis}
        />
      </>
    );
  }

  if (f.value_type === 'boolean') {
    const eqValue = findVal('eq');
    return (
      <select name={`mf__${f.key}__eq`} class="filter-select" disabled={dis}>
        <option value="" selected={eqValue === ''}>
          Any
        </option>
        <option value="true" selected={eqValue === 'true'}>
          True
        </option>
        <option value="false" selected={eqValue === 'false'}>
          False
        </option>
      </select>
    );
  }

  // string type with discrete values: multi-select (default) + regex toggle.
  // When editing, the saved values determine which mode opens first.
  if (f.distinctValues && f.distinctValues.length > 0) {
    const eqValues = currentFilters.filter(cf => cf.op === 'eq').map(cf => cf.value);
    const reValue = findVal('re');
    const activeMode = reValue ? 'regex' : 'multi';

    return (
      <div class="filter-string-modes" data-active-mode={activeMode}>
        <div class="filter-mode-tabs">
          <button
            type="button"
            class={`filter-mode-tab${activeMode === 'multi' ? ' filter-mode-tab--active' : ''}`}
            data-mode-tab="multi"
          >
            Values
          </button>
          <button
            type="button"
            class={`filter-mode-tab${activeMode === 'regex' ? ' filter-mode-tab--active' : ''}`}
            data-mode-tab="regex"
          >
            Regex
          </button>
        </div>
        <div data-mode-content="multi" style={activeMode === 'multi' ? '' : 'display:none'}>
          <select
            multiple
            name={`mf__${f.key}__eq`}
            class="filter-multi-select"
            size={Math.min(f.distinctValues.length, 6) as number}
            disabled={dis}
          >
            {f.distinctValues.map(v => (
              <option value={v} selected={eqValues.includes(v)}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div data-mode-content="regex" style={activeMode === 'regex' ? '' : 'display:none'}>
          <input
            type="text"
            name={`mf__${f.key}__re`}
            class="filter-input"
            placeholder="regex…"
            value={reValue}
            disabled={dis}
          />
        </div>
      </div>
    );
  }

  // free-form string: regex only
  return (
    <input
      type="text"
      name={`mf__${f.key}__re`}
      class="filter-input"
      placeholder="regex…"
      value={findVal('re')}
      disabled={dis}
    />
  );
}

type ChipDraftState = 'unchanged' | 'added' | 'modified';

// Compare the active filter rows for `key` against the saved preset rows for
// the same key. Returns 'added' when the key is new to the preset, 'modified'
// when the values/ops differ, and 'unchanged' otherwise.
function chipDraftState(
  key: string,
  activeFilters: MetaFilter[],
  savedFilters: MetaFilter[] | null
): ChipDraftState {
  if (savedFilters == null) return 'unchanged';
  const savedForKey = savedFilters.filter(f => f.key === key);
  if (savedForKey.length === 0) return 'added';
  const activeForKey = activeFilters.filter(f => f.key === key);
  return metaFiltersEqual(activeForKey, savedForKey) ? 'unchanged' : 'modified';
}

// Keys present in the saved preset but not in the current active filters.
// entity_type is excluded because it's rendered as the Type dropdown rather
// than as a chip.
function removedPresetKeys(
  activeFilters: MetaFilter[],
  savedFilters: MetaFilter[] | null
): Map<string, MetaFilter[]> {
  const removed = new Map<string, MetaFilter[]>();
  if (savedFilters == null) return removed;
  const activeKeys = new Set(activeFilters.map(f => f.key));
  for (const f of savedFilters) {
    if (f.key === 'entity_type') continue;
    if (activeKeys.has(f.key)) continue;
    if (!removed.has(f.key)) removed.set(f.key, []);
    removed.get(f.key)!.push(f);
  }
  return removed;
}

// URL that re-adds a removed preset key back to the current active filters,
// preserving the pinned preset.
function restoreFilterUrl(
  activeFilters: MetaFilter[],
  restoreFilters: MetaFilter[],
  presetId: number | null
): string {
  const params = withPreset(new URLSearchParams(), presetId);
  for (const f of activeFilters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  for (const f of restoreFilters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  return `/entities?${params.toString()}`;
}

function cancelEditUrl(activeFilters: MetaFilter[], presetId: number | null): string {
  const params = withPreset(new URLSearchParams(), presetId);
  for (const f of activeFilters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  return `/entities${qs ? '?' + qs : ''}`;
}

export const FilterBar: FC<FilterBarProps> = ({
  activeFilters,
  availableFilters,
  addingKey,
  editingKey,
  entityTypes,
  presets,
  selectedPresetId,
  selectedPresetFilters,
  selectedEntityType,
  isDraft,
}) => {
  // Group active filters by key for chip display. The chips row excludes
  // entity_type (promoted to the Type dropdown); the save-preset preview
  // includes everything because a preset captures every active filter.
  const grouped = new Map<string, MetaFilter[]>();
  const groupedAll = new Map<string, MetaFilter[]>();
  for (const f of activeFilters) {
    if (!groupedAll.has(f.key)) groupedAll.set(f.key, []);
    groupedAll.get(f.key)!.push(f);
    if (f.key === 'entity_type') continue;
    if (!grouped.has(f.key)) grouped.set(f.key, []);
    grouped.get(f.key)!.push(f);
  }

  const activeKeys = new Set(activeFilters.map(f => f.key));
  // entity_type is rendered as the Type dropdown — don't list it in "Add filter".
  const inactive = availableFilters.filter(f => !activeKeys.has(f.key) && f.key !== 'entity_type');

  // The key whose panel should be open (editing takes priority)
  const openKey = editingKey || addingKey;

  const selectedPreset = presets.find(p => p.id === selectedPresetId) ?? null;
  const currentUrl = buildEntityUrl(activeFilters, selectedPresetId);
  // URL that drops all filters except the current entity type and drops the
  // preset param too. Used as the value of the "None" option so selecting it
  // returns to the bare type view (no preset, no extra filters).
  const bareTypeUrl = selectedEntityType
    ? `/entities?mf__entity_type__eq=${encodeURIComponent(selectedEntityType)}`
    : '/entities';

  return (
    <div class="filter-bar">
      {/* Row: Type + Preset controls */}
      <div class="filter-meta-row">
        <form action="/entities" method="get" class="filter-meta-form">
          <label class="filter-widget-label" for="entity-type-select">
            Type
          </label>
          <select
            id="entity-type-select"
            name="mf__entity_type__eq"
            class="filter-select"
            data-type-select
          >
            {entityTypes.length === 0 && <option value="">(no entity types)</option>}
            {entityTypes.map(t => (
              <option value={t} selected={selectedEntityType === t}>
                {t}
              </option>
            ))}
          </select>
          <button type="submit" class="filter-btn js-fallback" data-js-fallback>
            Go
          </button>
        </form>

        <div class="filter-meta-divider" aria-hidden="true" />

        <label class="filter-widget-label" for="preset-combo-input">
          Preset
        </label>

        {selectedPreset ? (
          <form
            method="post"
            action={`/entities/presets/${selectedPreset.id}`}
            class="filter-inline-form preset-combo-form"
            data-preset-save-changes
            data-is-draft={isDraft ? 'true' : 'false'}
          >
            {activeFilters.map(f => (
              <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
            ))}
            <div class="preset-combo" data-preset-combo>
              <input
                id="preset-combo-input"
                type="text"
                name="name"
                class="preset-combo-input"
                value={selectedPreset.name}
                data-original-name={selectedPreset.name}
                data-preset-name-input
                autocomplete="off"
                required
              />
              <button
                type="button"
                class="preset-combo-toggle"
                data-preset-combo-toggle
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-label="Pick a different preset"
              >
                ▾
              </button>
              <ul class="preset-combo-list" hidden data-preset-combo-list role="listbox">
                <li>
                  <a href={bareTypeUrl} role="option">
                    None
                  </a>
                </li>
                {presets
                  .filter(p => p.id !== selectedPresetId)
                  .map(p => (
                    <li>
                      <a href={p.url} role="option">
                        {p.name}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
            <button type="submit" class="filter-btn filter-btn-attention" data-preset-save-submit>
              <span aria-hidden="true" class="filter-btn-dot">
                ●
              </span>{' '}
              Save changes
            </button>
            <a
              href={selectedPreset.url}
              class="filter-clear"
              data-preset-revert
              title={`Revert to saved state for "${selectedPreset.name}"`}
            >
              Revert
            </a>
          </form>
        ) : (
          <select
            id="preset-combo-input"
            class="filter-select"
            data-preset-select
            data-current-url={currentUrl}
          >
            <option value={bareTypeUrl}>None</option>
            {presets.map(p => (
              <option value={p.url} data-preset-id={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {selectedPreset && (
          <form
            method="post"
            action={`/entities/presets/${selectedPreset.id}/delete`}
            class="filter-inline-form"
            data-preset-delete-form
            data-preset-name={selectedPreset.name}
          >
            <input type="hidden" name="return_to" value={currentUrl} />
            <button
              type="submit"
              class="filter-icon-btn"
              title={`Delete "${selectedPreset.name}"`}
              aria-label={`Delete preset ${selectedPreset.name}`}
            >
              🗑
            </button>
          </form>
        )}
      </div>

      {/* Save preset panel — shows a read-only preview of the filters being
          saved so users can see what's about to be captured. To change the
          filters, cancel and adjust them via the chips above. */}
      <div id="save-preset-panel" class="filter-inline-panel" style="display:none">
        <form method="post" action="/entities/presets" class="filter-inline-form">
          {activeFilters.map(f => (
            <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
          ))}
          <div class="save-preset-preview">
            <span class="filter-widget-label">Filters to save</span>
            <div class="save-preset-chips">
              {Array.from(groupedAll.entries()).map(([key, filters]) => (
                <span class="filter-chip filter-chip--readonly">
                  <span class="filter-chip-content">
                    <span class="filter-chip-key">{formatFieldLabel(key)}:</span>{' '}
                    <span class="filter-chip-val">{chipLabel(filters)}</span>
                  </span>
                </span>
              ))}
            </div>
            <span class="save-preset-hint">Cancel to adjust filters first.</span>
          </div>
          <input type="text" name="name" class="filter-input" placeholder="Preset name…" required />
          <button type="submit" class="filter-btn">
            Save
          </button>
          <button type="button" id="save-preset-cancel" class="filter-clear">
            Cancel
          </button>
        </form>
      </div>

      {/* Row 1: active chips + add-filter control + clear */}
      <div class="filter-chips-row">
        {Array.from(grouped.entries()).map(([key, filters]) => {
          const isEditing = editingKey === key;
          const draft = chipDraftState(key, activeFilters, selectedPresetFilters);
          const draftClass =
            draft === 'unchanged' ? '' : ` filter-chip--draft filter-chip--draft-${draft}`;
          return (
            <div
              class={`filter-chip${isEditing ? ' filter-chip--editing' : ''}${draftClass}`}
              data-filter-edit-key={key}
              title={
                draft === 'added'
                  ? 'Unsaved: filter not in preset'
                  : draft === 'modified'
                    ? 'Unsaved: filter differs from preset'
                    : undefined
              }
            >
              <a
                href={editFilterUrl(activeFilters, key, selectedPresetId)}
                class="filter-chip-content"
              >
                <span class="filter-chip-key">{formatFieldLabel(key)}:</span>{' '}
                <span class="filter-chip-val">{chipLabel(filters)}</span>
              </a>
              <a
                href={removeFilterUrl(activeFilters, key, selectedPresetId)}
                class="filter-chip-x"
                title={`Remove ${key} filter`}
                aria-label={`Remove ${key} filter`}
              >
                ×
              </a>
            </div>
          );
        })}

        {Array.from(removedPresetKeys(activeFilters, selectedPresetFilters).entries()).map(
          ([key, filters]) => (
            <a
              href={restoreFilterUrl(activeFilters, filters, selectedPresetId)}
              class="filter-chip filter-chip--draft filter-chip--draft-removed"
              data-filter-removed-key={key}
              title={`Unsaved: filter removed from preset — click to restore`}
            >
              <span class="filter-chip-content">
                <span class="filter-chip-key">{formatFieldLabel(key)}:</span>{' '}
                <span class="filter-chip-val">{chipLabel(filters)}</span>
              </span>
              <span class="filter-chip-x" aria-hidden="true">
                ↺
              </span>
            </a>
          )
        )}

        {inactive.length > 0 && (
          <div class="filter-add-wrapper" data-filter-add-wrapper>
            {/* No-JS: select + submit navigates to ?add_filter=KEY to open widget panel */}
            <form action="/entities" method="get" class="filter-add-form" data-filter-add-form>
              {selectedPresetId != null && (
                <input type="hidden" name="preset" value={String(selectedPresetId)} />
              )}
              {activeFilters.map(f => (
                <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
              ))}
              <select
                name="add_filter"
                class="filter-select filter-add-select"
                data-filter-add-select
              >
                <option value="">+ Add filter</option>
                {(() => {
                  const entityFields = inactive.filter(f => f.entityType === '');
                  const metadataByType = new Map<string, (typeof inactive)[0][]>();
                  for (const f of inactive.filter(f => f.entityType !== '')) {
                    if (!metadataByType.has(f.entityType)) {
                      metadataByType.set(f.entityType, []);
                    }
                    metadataByType.get(f.entityType)!.push(f);
                  }
                  const sortedTypes = Array.from(metadataByType.keys()).sort();
                  return (
                    <>
                      {entityFields.length > 0 && (
                        <optgroup label="Fields">
                          {entityFields.map(f => (
                            <option
                              value={f.key}
                              selected={addingKey === f.key}
                              data-type={f.value_type}
                            >
                              {formatFieldLabel(f.key)} · {formatValueType(f.value_type)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {sortedTypes.map(entityType => (
                        <optgroup label={entityType}>
                          {metadataByType.get(entityType)!.map(f => (
                            <option
                              value={f.key}
                              selected={addingKey === f.key}
                              data-type={f.value_type}
                            >
                              {formatFieldLabel(f.key)} · {formatValueType(f.value_type)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </>
                  );
                })()}
              </select>
              <button type="submit" class="filter-btn filter-add-submit" data-filter-add-submit>
                Add
              </button>
            </form>
          </div>
        )}

        {selectedPresetId === null && (
          <button type="button" id="save-preset-btn" class="filter-btn filter-btn-secondary">
            Save…
          </button>
        )}

        {grouped.size > 0 && selectedEntityType && (
          <a
            href={`/entities?mf__entity_type__eq=${encodeURIComponent(selectedEntityType)}`}
            class="filter-clear"
          >
            Clear all
          </a>
        )}
      </div>

      {/* Widget panels inside one form */}
      <form action="/entities" method="get" class="filter-form" data-filter-form>
        {selectedPresetId != null && (
          <input type="hidden" name="preset" value={String(selectedPresetId)} />
        )}
        {/* Preserve active filters as hidden inputs, excluding the key being edited */}
        {activeFilters
          .filter(f => f.key !== editingKey)
          .map(f => (
            <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
          ))}

        {/* One widget panel per unique key (deduplicated by key). Skip entity_type — promoted to Type dropdown. */}
        {Array.from(
          new Map(
            availableFilters
              .filter(f => f.key !== 'entity_type')
              .sort((a, b) => a.entityType.localeCompare(b.entityType))
              .map(f => [f.key, f])
          ).values()
        ).map(f => {
          const isOpen = openKey === f.key;
          const isEditPanel = editingKey === f.key;
          return (
            <div
              class="filter-widget-panel"
              data-filter-key={f.key}
              data-filter-type={f.value_type}
              data-filter-editing={isEditPanel ? 'true' : undefined}
              style={isOpen ? '' : 'display:none'}
            >
              <span class="filter-widget-label">{formatFieldLabel(f.key)}</span>
              {renderWidget(
                f,
                isOpen,
                isEditPanel ? activeFilters.filter(af => af.key === f.key) : []
              )}
              <button type="submit" class="filter-btn filter-widget-apply">
                Apply
              </button>
              {isEditPanel ? (
                <a
                  href={cancelEditUrl(activeFilters, selectedPresetId)}
                  class="filter-clear filter-widget-cancel"
                >
                  Cancel
                </a>
              ) : (
                <button type="button" class="filter-clear filter-widget-cancel" data-filter-cancel>
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </form>
    </div>
  );
};
