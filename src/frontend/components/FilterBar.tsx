import type { FC } from 'hono/jsx';
import type { AvailableFilter } from '../../schemas/entity';
import type { Preset } from '../../schemas/preset';
import type { FilterTree } from '../../schemas/filterTree';
import {
  allLeavesNegated,
  distributeGroupNots,
  isGroup,
  isLeaf,
  makeLeaf,
  emptyTree,
} from '../../schemas/filterTree';
import type { FilterLeaf, FilterNode } from '../../schemas/filterTree';
import { buildEntityUrl, encodeTree } from '../../domain/filterUrl';

export type PresetWithUrl = Preset & { url: string };

type FilterBarProps = {
  activeTree: FilterTree;
  availableFilters: AvailableFilter[];
  entityTypes: string[];
  presets: PresetWithUrl[];
  selectedPresetId: number | null;
  selectedPresetTree: FilterTree | null;
  selectedEntityType: string | null;
  isDraft: boolean;
};

function formatFieldLabel(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function leafLabel(leaf: FilterLeaf): string {
  const v = leaf.value;
  if (leaf.op === 'eq') {
    if (Array.isArray(v)) return v.join(', ');
    return v;
  }
  const s = Array.isArray(v) ? v[0] : v;
  if (leaf.op === 'gte') return `≥ ${s}`;
  if (leaf.op === 'lte') return `≤ ${s}`;
  if (leaf.op === 're') return `/${s}/`;
  if (leaf.op === 'contains') return `~${s}`;
  return String(s);
}

// Build a fresh tree containing only the chosen entity_type. Switching type
// clears any other filters — the available-key set changes per type, so
// carrying old filters across would surface options that no longer apply.
function urlForEntityType(_activeTree: FilterTree, entityType: string): string {
  const next: FilterTree = {
    type: 'group',
    id: 'root',
    op: 'AND',
    children: [makeLeaf('entity_type', 'eq', entityType)],
  };
  return buildEntityUrl(next);
}

// NOT(leaf) collapses into a negated-leaf chip; the wrapper isn't rendered.
// All other NOT shapes are eliminated by `distributeGroupNots` before render,
// so the only "negation" the view layer sees is a unary NOT wrapping a leaf.
function unwrapLeafNot(node: FilterNode): { leaf: FilterLeaf; negated: boolean } | null {
  if (isLeaf(node)) return { leaf: node, negated: false };
  if (node.op === 'NOT' && node.children.length === 1 && isLeaf(node.children[0])) {
    return { leaf: node.children[0], negated: true };
  }
  return null;
}

const NotBtn: FC<{ id: string; active: boolean; label: string }> = ({ id, active, label }) => (
  <button
    type="button"
    class={`filter-not-btn${active ? ' filter-not-btn--active' : ''}`}
    data-toggle-not={id}
    draggable={false}
    aria-pressed={active ? 'true' : 'false'}
    aria-label={label}
    title={active ? 'Remove !' : 'Negate'}
  >
    !
  </button>
);

const FilterTreeView: FC<{
  node: FilterNode;
  depth: number;
  isRoot?: boolean;
}> = ({ node: input, depth, isRoot }) => {
  const asLeaf = unwrapLeafNot(input);
  if (asLeaf) {
    const { leaf, negated } = asLeaf;
    return (
      <span
        class={`filter-chip${negated ? ' filter-chip--negated' : ''}`}
        data-node-id={leaf.id}
        data-node-type="filter"
        data-filter-key={leaf.key}
        data-negated={negated ? 'true' : undefined}
        draggable="true"
      >
        <span class="filter-chip-grip" aria-hidden="true">
          ⋮⋮
        </span>
        <span class="filter-chip-content" data-edit-leaf>
          <span class="filter-chip-key">{formatFieldLabel(leaf.key)}:</span>{' '}
          <span class="filter-chip-val" title={leafLabel(leaf)}>
            {leafLabel(leaf)}
          </span>
        </span>
        <NotBtn id={leaf.id} active={negated} label={`Negate ${leaf.key} filter`} />
        <button
          type="button"
          class="filter-chip-x"
          data-remove-node
          aria-label={`Remove ${leaf.key} filter`}
        >
          ×
        </button>
      </span>
    );
  }
  if (isGroup(input)) {
    const groupNegated = allLeavesNegated(input);
    return (
      <div
        class={`filter-group${isRoot ? ' filter-group--root' : ''}${groupNegated ? ' filter-group--negated' : ''}`}
        data-node-id={input.id}
        data-node-type="group"
        data-group-op={input.op}
        data-depth={depth}
        data-negated={groupNegated ? 'true' : undefined}
        draggable={isRoot ? undefined : 'true'}
      >
        {!isRoot && (
          <span class="filter-group-grip" aria-hidden="true">
            ⋮⋮
          </span>
        )}
        {input.children.length === 0 ? (
          <span class="filter-group-empty">No filters yet</span>
        ) : (
          input.children.map((child, i) =>
            i === 0 ? (
              <div class="filter-tree-cluster">
                <span class="filter-drop-line" data-drop-line={`${input.id}:0`} />
                <FilterTreeView node={child} depth={depth + 1} />
                <span class="filter-drop-line" data-drop-line={`${input.id}:1`} />
              </div>
            ) : (
              <div class="filter-tree-cluster">
                <button
                  type="button"
                  class="filter-op-badge"
                  data-toggle-pair={`${input.id}:${i}`}
                  draggable={false}
                  aria-label={`Toggle operator between filters (currently ${input.op})`}
                >
                  {input.op}
                </button>
                <span class="filter-drop-line" data-drop-line={`${input.id}:${i}`} />
                <FilterTreeView node={child} depth={depth + 1} />
                <span class="filter-drop-line" data-drop-line={`${input.id}:${i + 1}`} />
              </div>
            )
          )
        )}
        {!isRoot && (
          <>
            <NotBtn id={input.id} active={groupNegated} label="Negate group" />
            <button type="button" class="filter-group-x" data-remove-node aria-label="Remove group">
              ×
            </button>
          </>
        )}
      </div>
    );
  }
  return null;
};

export const FilterBar: FC<FilterBarProps> = ({
  activeTree,
  availableFilters,
  entityTypes,
  presets,
  selectedPresetId,
  selectedPresetTree,
  selectedEntityType,
  isDraft,
}) => {
  const selectedPreset = presets.find(p => p.id === selectedPresetId) ?? null;
  const currentUrl = buildEntityUrl(activeTree, selectedPresetId);
  const bareTypeUrl = selectedEntityType
    ? buildEntityUrl({
        type: 'group',
        id: 'root',
        op: 'AND',
        children: [makeLeaf('entity_type', 'eq', selectedEntityType)],
      })
    : '/entities';

  // Strip the entity_type leaf from the tree shown to the client — it lives
  // in the Type dropdown, not the tree view. The client merges it back when
  // building the final URL. We also normalize any legacy NOT(group) wrappers
  // into per-leaf NOTs so the view layer only has to handle NOT(leaf).
  const visibleTree = distributeGroupNots({
    ...activeTree,
    children: activeTree.children.filter(c => !(isLeaf(c) && c.key === 'entity_type')),
  }) as FilterTree;

  return (
    <div class="filter-bar" data-filter-bar>
      {/* JSON embeds — client hydration */}
      <script
        type="application/json"
        id="filter-tree-initial"
        // The script embed is parsed client-side as JSON during hydration —
        // keep it as raw JSON. The URL/form encoders use the hex codec.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(visibleTree) }}
      />
      <script
        type="application/json"
        id="filter-available"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(availableFilters) }}
      />
      <script
        type="application/json"
        id="filter-selected-preset-tree"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(selectedPresetTree ?? null),
        }}
      />
      <script
        type="application/json"
        id="filter-config"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            selectedPresetId,
            selectedEntityType,
            isDraft,
          }),
        }}
      />

      {/* Row: Type + Preset controls */}
      <div class="filter-meta-row">
        <label class="filter-widget-label" for="entity-type-select">
          Type
        </label>
        <select
          id="entity-type-select"
          class="filter-select"
          data-entity-type-select
          data-base-url-template={JSON.stringify(
            entityTypes.map(t => ({ type: t, url: urlForEntityType(activeTree, t) }))
          )}
        >
          {entityTypes.length === 0 && <option value="">(no entity types)</option>}
          {entityTypes.map(t => (
            <option value={t} selected={selectedEntityType === t}>
              {t}
            </option>
          ))}
        </select>

        <div class="filter-meta-divider" aria-hidden="true" />

        <label class="filter-widget-label" for="preset-combo-input">
          Preset
        </label>

        {selectedPreset ? (
          <div
            class="preset-combo-wrap"
            data-preset-save-changes
            data-is-draft={isDraft ? 'true' : 'false'}
          >
            <div class="preset-combo" data-preset-combo>
              <input
                id="preset-combo-input"
                type="text"
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
            <button
              type="button"
              class="filter-btn filter-btn-attention"
              data-preset-save-submit
              data-preset-id={String(selectedPreset.id)}
            >
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
          </div>
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

      {/* Save-preset panel (hidden until requested via "Save…") */}
      <div id="save-preset-panel" class="filter-inline-panel" style="display:none">
        <form
          method="post"
          action="/entities/presets"
          class="filter-inline-form"
          data-save-preset-form
        >
          <input type="hidden" name="tree" data-save-preset-tree value={encodeTree(activeTree)} />
          <input type="text" name="name" class="filter-input" placeholder="Preset name…" required />
          <button type="submit" class="filter-btn">
            Save
          </button>
          <button type="button" id="save-preset-cancel" class="filter-clear">
            Cancel
          </button>
        </form>
      </div>

      {/* Selection toolbar — hidden until 2+ chips are selected via shift-click */}
      <div
        class="filter-selection-toolbar"
        data-filter-selection-toolbar
        role="toolbar"
        aria-label="Group selected filters"
        hidden
      >
        <span class="filter-selection-count">
          <strong data-selection-count>0</strong> selected
        </span>
        <button type="button" class="filter-btn" data-group-as="AND">
          Group as AND
        </button>
        <button type="button" class="filter-btn" data-group-as="OR">
          Group as OR
        </button>
        <button type="button" class="filter-clear" data-clear-selection>
          Clear
        </button>
      </div>

      {/* The filter tree root + apply bar */}
      <div class="filter-tree-container" data-filter-tree-root>
        <FilterTreeView node={visibleTree} depth={0} isRoot />
      </div>

      <div class="filter-action-row">
        <div class="filter-add-wrapper" data-filter-add-wrapper>
          <select class="filter-select filter-add-select" data-filter-add-select>
            <option value="">+ Add filter</option>
            {(() => {
              const entityFields = availableFilters.filter(
                f => f.entityType === '' && f.key !== 'entity_type'
              );
              const metadataByType = new Map<string, AvailableFilter[]>();
              for (const f of availableFilters.filter(f => f.entityType !== '')) {
                if (!metadataByType.has(f.entityType)) metadataByType.set(f.entityType, []);
                metadataByType.get(f.entityType)!.push(f);
              }
              const sortedTypes = Array.from(metadataByType.keys()).sort();
              return (
                <>
                  {entityFields.length > 0 && (
                    <optgroup label="Fields">
                      {entityFields.map(f => (
                        <option value={f.key} data-type={f.value_type}>
                          {formatFieldLabel(f.key)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {sortedTypes.map(entityType => (
                    <optgroup label={entityType}>
                      {metadataByType.get(entityType)!.map(f => (
                        <option value={f.key} data-type={f.value_type}>
                          {formatFieldLabel(f.key)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </>
              );
            })()}
          </select>
        </div>

        {selectedPresetId === null && (
          <button type="button" id="save-preset-btn" class="filter-btn filter-btn-secondary">
            Save…
          </button>
        )}

        {visibleTree.children.length > 0 && selectedEntityType && (
          <a href={bareTypeUrl} class="filter-clear" data-clear-all>
            Clear all
          </a>
        )}
      </div>

      {/* Hidden widget templates — one per available key, used by the client
          to render an edit modal/inline panel when a chip is clicked. */}
      <div class="filter-widget-templates" hidden data-filter-widget-templates>
        {availableFilters
          .filter(f => f.key !== 'entity_type')
          .map(f => (
            <template data-filter-widget-template data-filter-key={f.key}>
              <div class="filter-widget-panel" data-filter-type={f.value_type}>
                <span class="filter-widget-label">{formatFieldLabel(f.key)}</span>
                <div class="filter-widget-body" data-widget-body>
                  {/* Body is built by the client from available filter metadata */}
                </div>
                <button type="button" class="filter-btn filter-widget-apply" data-widget-apply>
                  Apply
                </button>
                <button type="button" class="filter-clear filter-widget-cancel" data-widget-cancel>
                  Cancel
                </button>
              </div>
            </template>
          ))}
      </div>
    </div>
  );
};

// Re-exported so other modules can import it without pulling FilterBar itself.
export { emptyTree };
