import { describe, it, expect } from 'bun:test';
import { computeVisibleFilterTree, FilterBar } from './FilterBar';
import { collectLeaves, emptyTree, isLeaf, makeGroup, makeLeaf } from '../../schemas/filterTree';

describe('computeVisibleFilterTree', () => {
  it('strips a top-level entity_type leaf', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'jira_ticket'),
      makeLeaf('entity_name', 'contains', 'TH-'),
    ]);
    const result = computeVisibleFilterTree(tree);
    expect(collectLeaves(result).map(l => l.key)).toEqual(['entity_name']);
  });

  it('strips an entity_type leaf nested inside a sub-group', () => {
    // Regression: "View excluded entities" links (chartDataHandler's
    // combineWithExtras) nest the viz's preset tree — which carries its own
    // entity_type leaf — as a child group under a fresh root, rather than as
    // a direct child of root. A shallow top-level strip missed this and let
    // "Entity Type: jira_ticket" leak through as a redundant filter chip even
    // though the Type dropdown already showed it.
    const presetTree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'jira_ticket'),
      makeLeaf('entity_name', 'contains', 'TH-'),
    ]);
    const root = makeGroup('AND', [
      presetTree,
      makeGroup('OR', [
        makeLeaf('computed_completed_at', 'gte', ''),
        makeLeaf('development_lead_time_seconds', 'gte', ''),
      ]),
    ]);
    const result = computeVisibleFilterTree(root);
    const leafKeys = collectLeaves(result).map(l => l.key);
    expect(leafKeys).not.toContain('entity_type');
    expect(leafKeys).toEqual([
      'entity_name',
      'computed_completed_at',
      'development_lead_time_seconds',
    ]);
  });

  it('preserves non-entity_type filters and does not mutate the input', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'github_pr'),
      makeLeaf('assignee', 'eq', 'dev-001'),
    ]);
    const before = JSON.parse(JSON.stringify(tree));
    const result = computeVisibleFilterTree(tree);
    expect(collectLeaves(result).map(l => `${l.key}=${l.value}`)).toEqual(['assignee=dev-001']);
    expect(tree).toEqual(before);
  });

  it('normalizes a NOT-wrapped group into per-leaf NOTs', () => {
    const tree = makeGroup('AND', [
      makeGroup('NOT', [
        makeGroup('OR', [
          makeLeaf('assignee', 'eq', 'dev-001'),
          makeLeaf('assignee', 'eq', 'dev-002'),
        ]),
      ]),
    ]);
    const result = computeVisibleFilterTree(tree);
    const outer = result.children[0];
    expect(isLeaf(outer)).toBe(false);
    if (!isLeaf(outer)) {
      expect(outer.op).toBe('OR');
      for (const child of outer.children) {
        expect(isLeaf(child)).toBe(false);
        if (!isLeaf(child)) expect(child.op).toBe('NOT');
      }
    }
  });
});

// Scripts pair the i-th <option> of a navigating select with the i-th link in
// the HiddenLinks container named after the select's id, so the counts must
// always match.
describe('FilterBar navigating selects', () => {
  const render = (entityTypes: string[]) =>
    String(
      FilterBar({
        activeTree: emptyTree(),
        availableFilters: [],
        entityTypes,
        presets: [
          { id: 1, name: 'One', url: '/entities?preset=1' },
          { id: 2, name: 'Two', url: '/entities?preset=2' },
        ],
        selectedPresetId: null,
        selectedPresetTree: null,
        selectedEntityType: entityTypes[0] ?? null,
        isDraft: false,
      })
    );

  const count = (html: string, pattern: RegExp, tag: string) => {
    const block = html.match(pattern)?.[0];
    expect(block).toBeDefined();
    return block!.split(`<${tag}`).length - 1;
  };
  const optionCount = (html: string, id: string) =>
    count(html, new RegExp(`<select id="${id}"[\\s\\S]*?</select>`), 'option');
  const linkCount = (html: string, id: string) =>
    count(html, new RegExp(`<div hidden="" data-links="${id}">[\\s\\S]*?</div>`), 'a');

  for (const entityTypes of [[], ['jira_ticket', 'github_pr']]) {
    it(`pairs every option with a link (${entityTypes.length} entity types)`, () => {
      const html = render(entityTypes);
      for (const id of ['entity-type-select', 'preset-combo-input']) {
        expect(linkCount(html, id)).toBe(optionCount(html, id));
      }
    });
  }
});
