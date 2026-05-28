import type { FC } from 'hono/jsx';
import type { MetaFilter, AvailableFilter } from '../../schemas/entity';

type FilterBarProps = {
  activeFilters: MetaFilter[];
  availableFilters: AvailableFilter[];
  addingKey?: string;
  editingKey?: string;
};

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

function removeFilterUrl(activeFilters: MetaFilter[], removeKey: string): string {
  const params = new URLSearchParams();
  for (const f of activeFilters) {
    if (f.key === removeKey) continue;
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  return `/entities${qs ? '?' + qs : ''}`;
}

function editFilterUrl(activeFilters: MetaFilter[], editKey: string): string {
  const params = new URLSearchParams();
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

function renderWidget(f: AvailableFilter, isOpen: boolean) {
  const dis = !isOpen;

  if (f.value_type === 'date') {
    return (
      <>
        <input type="date" name={`mf__${f.key}__gte`} class="filter-input" disabled={dis} />
        <span class="filter-sep">–</span>
        <input type="date" name={`mf__${f.key}__lte`} class="filter-input" disabled={dis} />
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
          disabled={dis}
        />
        <span class="filter-sep">–</span>
        <input
          type="number"
          name={`mf__${f.key}__lte`}
          class="filter-input filter-input-sm"
          placeholder="max"
          disabled={dis}
        />
      </>
    );
  }

  if (f.value_type === 'boolean') {
    return (
      <select name={`mf__${f.key}__eq`} class="filter-select" disabled={dis}>
        <option value="">Any</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  // string type with discrete values: multi-select (default) + regex toggle
  if (f.distinctValues && f.distinctValues.length > 0) {
    return (
      <div class="filter-string-modes" data-active-mode="multi">
        <div class="filter-mode-tabs">
          <button
            type="button"
            class="filter-mode-tab filter-mode-tab--active"
            data-mode-tab="multi"
          >
            Values
          </button>
          <button type="button" class="filter-mode-tab" data-mode-tab="regex">
            Regex
          </button>
        </div>
        <div data-mode-content="multi">
          <select
            multiple
            name={`mf__${f.key}__eq`}
            class="filter-multi-select"
            size={Math.min(f.distinctValues.length, 6) as number}
            disabled={dis}
          >
            {f.distinctValues.map(v => (
              <option value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div data-mode-content="regex" style="display:none">
          <input
            type="text"
            name={`mf__${f.key}__re`}
            class="filter-input"
            placeholder="regex…"
            disabled
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
      disabled={dis}
    />
  );
}

function cancelEditUrl(activeFilters: MetaFilter[]): string {
  const params = new URLSearchParams();
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
}) => {
  // Group active filters by key for chip display
  const grouped = new Map<string, MetaFilter[]>();
  for (const f of activeFilters) {
    if (!grouped.has(f.key)) grouped.set(f.key, []);
    grouped.get(f.key)!.push(f);
  }

  const activeKeys = new Set(activeFilters.map(f => f.key));
  const inactive = availableFilters.filter(f => !activeKeys.has(f.key));

  // The key whose panel should be open (editing takes priority)
  const openKey = editingKey || addingKey;

  return (
    <div class="filter-bar">
      {/* Row 1: active chips + add-filter control + clear */}
      <div class="filter-chips-row">
        {Array.from(grouped.entries()).map(([key, filters]) => {
          const isEditing = editingKey === key;
          return (
            <div
              class={`filter-chip${isEditing ? ' filter-chip--editing' : ''}`}
              data-filter-edit-key={key}
            >
              <a
                href={editFilterUrl(activeFilters, key)}
                class="filter-chip-content"
                title={`Edit ${key} filter`}
              >
                <span class="filter-chip-key">{formatFieldLabel(key)}:</span>{' '}
                <span class="filter-chip-val">{chipLabel(filters)}</span>
              </a>
              <a
                href={removeFilterUrl(activeFilters, key)}
                class="filter-chip-x"
                title={`Remove ${key} filter`}
                aria-label={`Remove ${key} filter`}
              >
                ×
              </a>
            </div>
          );
        })}

        {inactive.length > 0 && (
          <div class="filter-add-wrapper" data-filter-add-wrapper>
            {/* No-JS: select + submit navigates to ?add_filter=KEY to open widget panel */}
            <form action="/entities" method="get" class="filter-add-form" data-filter-add-form>
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

        {activeFilters.length > 0 && (
          <a href="/entities" class="filter-clear">
            Clear all
          </a>
        )}
      </div>

      {/* Widget panels inside one form */}
      <form action="/entities" method="get" class="filter-form" data-filter-form>
        {/* Preserve active filters as hidden inputs, excluding the key being edited */}
        {activeFilters
          .filter(f => f.key !== editingKey)
          .map(f => (
            <input type="hidden" name={`mf__${f.key}__${f.op}`} value={f.value} />
          ))}

        {/* One widget panel per unique key (deduplicated by key) */}
        {Array.from(
          new Map(
            availableFilters
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
              {renderWidget(f, isOpen)}
              <button type="submit" class="filter-btn filter-widget-apply">
                Apply
              </button>
              {isEditPanel ? (
                <a href={cancelEditUrl(activeFilters)} class="filter-clear filter-widget-cancel">
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
