import { test, expect } from './strictTest';
import { decodeTreeFromUrl, entitiesUrl, group, leaf } from './treeUrl';

test('redirects root to /entities', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/entities(\?|$)/);
});

test('entities page has correct title and heading', async ({ page }) => {
  await page.goto('/entities');
  await expect(page).toHaveTitle(/Entities.*Dev Waymark/);
  await expect(page.locator('h1')).toHaveText('Entities');
});

test('filter tree container and add-filter control are present', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('[data-filter-tree-root]')).toBeAttached();
  await expect(page.locator('[data-filter-add-select]')).toBeAttached();
});

test('available filters populate distinct values for string metadata (regression)', async ({
  page,
}) => {
  // Regression: the str_vals CTE behind getAvailableFilters selected
  // em.value_type without including it in GROUP BY. SQLite tolerates this
  // silently, but Postgres rejects it with "column ... must appear in the
  // GROUP BY clause", which broke every /entities load. Read the embedded
  // filter-available data directly rather than just checking the page didn't
  // 500, so a future re-introduction of the same non-aggregated column fails
  // this test even if the surrounding page still renders.
  await page.goto(entitiesUrl('jira_ticket'));
  const raw = await page.locator('#filter-available').textContent();
  const available = JSON.parse(raw ?? '[]') as { key: string; distinctValues?: string[] }[];
  const ticketType = available.find(f => f.key === 'ticket_type');
  expect(ticketType?.distinctValues?.length).toBeGreaterThan(0);
});

test('entity detail page loads and shows metadata section', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket'));
  const firstLink = page.locator('table.entity-table a.entity-link').first();
  await firstLink.click();
  await expect(page.locator('h2')).toHaveText('Metadata');
  await expect(page.locator('.back-link')).toBeVisible();
});

test('unknown entity id returns 404', async ({ page }) => {
  const response = await page.goto('/entities/does-not-exist');
  expect(response?.status()).toBe(404);
});

test('metadata column stays visible when every result on the page is null for it', async ({
  page,
}) => {
  // last_ready_at is populated only on even github_pr rows in the seed. An
  // empty-bound gte filter carries IS NULL semantics, so this narrows the page
  // to the odd rows — every one of which is null for last_ready_at. The column
  // must still render (a column of em-dashes) because it's a valid key for the
  // github_pr type; it should not vanish just because no row in view has a value.
  await page.goto(entitiesUrl('github_pr', [leaf('last_ready_at', 'gte', '')]));

  const rows = page.locator('table.entity-table tbody tr');
  await expect(rows.first()).toBeVisible();

  const headers = page.locator('table.entity-table thead th');
  await expect(headers.filter({ hasText: 'last_ready_at' })).toHaveCount(1);

  // Sanity: the column exists but is entirely null in this view.
  const colIndex = (await headers.allTextContents()).indexOf('last_ready_at');
  const cells = rows.locator(`td:nth-child(${colIndex + 1})`);
  const values = await cells.allTextContents();
  expect(values.length).toBeGreaterThan(0);
  expect(values.every(v => v.trim() === '—')).toBe(true);
});

test('filter chip: click opens popover editor, × auto-applies the removal', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'eq', 'Story')]));

  const chip = page.locator('.filter-chip[data-filter-key="ticket_type"]');
  await expect(chip).toBeVisible();

  // Click chip content → popover editor opens (purely client-side; URL unchanged).
  await chip.locator('.filter-chip-content').click();
  const editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();

  // Cancel removes the popover and leaves state untouched.
  await editor.locator('.filter-widget-cancel').click();
  await expect(editor).toHaveCount(0);

  // × removes the chip from the in-memory tree → URL updates automatically
  // (no Apply button — auto-apply via fetch + history.replaceState).
  await chip.locator('.filter-chip-x').click();
  await expect(chip).toHaveCount(0);
  await expect
    .poll(() => {
      const tree = decodeTreeFromUrl(page.url());
      return tree?.children.some(c => c.type === 'filter' && c.key === 'ticket_type') ?? false;
    })
    .toBe(false);
});

test('editing a date filter prefills the date pickers with saved values', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('jira_created_at', 'gte', '2024-01-05')]));

  const chip = page.locator('.filter-chip[data-filter-key="jira_created_at"]');
  await expect(chip).toBeVisible();
  await chip.locator('.filter-chip-content').click();

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[data-op="gte"]')).toHaveValue('2024-01-05');
});

test('editing a multi-select chip preselects the saved values', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'eq', ['Story', 'Bug'])]));

  const chip = page.locator('.filter-chip[data-filter-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();
  const selected = await editor.locator('select[multiple] option:checked').allTextContents();
  expect(selected.sort()).toEqual(['Bug', 'Story']);
});

test('editing a multi-select chip shows all values that would be available with the filter disabled', async ({
  page,
}) => {
  // Creator filter on github_pr is the canonical case: with creator=dev-001
  // applied, the filtered entity set only contains dev-001, so a naive
  // implementation would render a multi-select with just one option. The
  // editor should instead surface every creator value that exists when this
  // leaf is excluded from the tree.
  await page.goto(entitiesUrl('github_pr', [leaf('creator', 'eq', 'dev-001')]));

  const chip = page.locator('.filter-chip[data-filter-key="creator"]');
  await expect(chip).toBeVisible();
  await chip.locator('.filter-chip-content').click();

  // While the editor is open, the chip should be visibly disabled so the user
  // can see that the filter is temporarily inactive for the purpose of
  // computing available values.
  await expect(chip).toHaveClass(/filter-chip--editing/);

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();

  // Wait for the editor to surface the unrestricted value set (the fetch for
  // available values happens after the editor opens). The github_pr seed has
  // 25 distinct creators — past the default distinctValues cap of 20, so this
  // doubly proves that the cap is lifted for the editor's fetch.
  const expected = Array.from({ length: 25 }, (_, i) => `dev-${String(i + 1).padStart(3, '0')}`);
  await expect
    .poll(async () =>
      (await editor.locator('select[multiple] option').allTextContents()).slice().sort()
    )
    .toEqual(expected);

  // The saved value is still preselected.
  const selected = await editor.locator('select[multiple] option:checked').allTextContents();
  expect(selected).toEqual(['dev-001']);
});

test('editing one of two same-field chips still shows every value with the current one selected', async ({
  page,
}) => {
  // Regression: with two `creator` badges applied, editing either used to strip
  // only the clicked leaf from the tree before asking the server for values —
  // so the sibling badge would still narrow the dropdown to its own value, and
  // the value being edited was missing (rendered as "0 selected"). Use an OR
  // sub-group so the current-filter result set isn't empty — with an empty
  // set the initial available data has no `creator` entry and the editor
  // silently refuses to open (a different concern).
  await page.goto(
    entitiesUrl('github_pr', [
      group('OR', [leaf('creator', 'eq', 'dev-001'), leaf('creator', 'eq', 'dev-002')]),
    ])
  );

  const expected = Array.from({ length: 25 }, (_, i) => `dev-${String(i + 1).padStart(3, '0')}`);
  const chips = page.locator('.filter-chip[data-filter-key="creator"]');
  await expect(chips).toHaveCount(2);

  // Edit the first creator badge (dev-001).
  await chips.nth(0).locator('.filter-chip-content').click();
  let editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();
  await expect
    .poll(async () =>
      (await editor.locator('select[multiple] option').allTextContents()).slice().sort()
    )
    .toEqual(expected);
  expect(await editor.locator('select[multiple] option:checked').allTextContents()).toEqual([
    'dev-001',
  ]);
  await editor.locator('.filter-widget-cancel').click();
  await expect(editor).toHaveCount(0);

  // Edit the second creator badge (dev-002) — same expectations, different preselection.
  await chips.nth(1).locator('.filter-chip-content').click();
  editor = page.locator('[data-leaf-editor]');
  await expect(editor).toBeVisible();
  await expect
    .poll(async () =>
      (await editor.locator('select[multiple] option').allTextContents()).slice().sort()
    )
    .toEqual(expected);
  expect(await editor.locator('select[multiple] option:checked').allTextContents()).toEqual([
    'dev-002',
  ]);
});

test('editing a contains filter prefills the contains input and opens that mode', async ({
  page,
}) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'contains', 'Story')]));

  const chip = page.locator('.filter-chip[data-filter-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor.locator('[data-active-mode]')).toHaveAttribute(
    'data-active-mode',
    'contains'
  );
  await expect(editor.locator('input[data-op="contains"]')).toHaveValue('Story');
});

test('exact filter matches the literal value only — no substring behavior', async ({ page }) => {
  // ticket_type values in the e2e seed are Story/Bug/Task/Spike. `contains 'S'`
  // matches Story + Spike; `exact 'S'` matches nothing. Any row count > 0 for
  // contains combined with 0 for exact proves the operator is a literal match.
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'contains', 'S')]));
  const containsCount = await page.locator('table.entity-table tbody tr').count();
  expect(containsCount).toBeGreaterThan(0);

  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'exact', 'S')]));
  await expect(page.locator('table.entity-table tbody tr')).toHaveCount(0);

  // Sanity check the positive path: exact 'Story' should match Story rows and
  // the chip label should render as `= Story`.
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'exact', 'Story')]));
  const exactCount = await page.locator('table.entity-table tbody tr').count();
  expect(exactCount).toBeGreaterThan(0);
  await expect(
    page.locator('.filter-chip[data-filter-key="ticket_type"] .filter-chip-val')
  ).toHaveText('= Story');
});

test('editing an exact filter prefills the exact input and opens that mode', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 'exact', 'Story')]));

  const chip = page.locator('.filter-chip[data-filter-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor.locator('[data-active-mode]')).toHaveAttribute('data-active-mode', 'exact');
  await expect(editor.locator('input[data-op="exact"]')).toHaveValue('Story');
});

test('drag a chip onto an insertion line reorders without grouping', async ({ page }) => {
  // Three sibling chips at root: ticket_type, status, priority — order A, B, C.
  await page.goto(
    entitiesUrl('jira_ticket', [
      leaf('ticket_type', 'eq', 'Story'),
      leaf('status', 'eq', 'open'),
      leaf('priority', 'eq', 'high'),
    ])
  );

  const status = page.locator('.filter-chip[data-filter-key="status"]');
  // The drop-line at index 0 lives at the very start of the root group.
  const startLine = page.locator('[data-filter-tree-root] [data-drop-line]').first();

  await status.dragTo(startLine);

  // Auto-apply: the URL's f tree should put status first, then ticket_type,
  // then priority — and the root group must still be AND (no new group).
  await expect
    .poll(() => {
      const t = decodeTreeFromUrl(page.url());
      return t?.children.map(c => (c.type === 'filter' ? c.key : '(group)')).join(',') ?? '';
    })
    .toBe('entity_type,status,ticket_type,priority');
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.op).toBe('AND');
});

test('dragging a chip onto another chip wraps them in a new sub-group', async ({ page }) => {
  await page.goto(
    entitiesUrl('jira_ticket', [
      leaf('ticket_type', 'eq', 'Story'),
      leaf('status', 'eq', 'open'),
      leaf('priority', 'eq', 'high'),
    ])
  );

  const dragged = page.locator('.filter-chip[data-filter-key="priority"]');
  const target = page.locator('.filter-chip[data-filter-key="ticket_type"]');

  await dragged.dragTo(target);

  // Auto-apply: wait until the URL reflects the new sub-group.
  await expect
    .poll(() => decodeTreeFromUrl(page.url())?.children.some(c => c.type === 'group') ?? false)
    .toBe(true);
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.op).toBe('AND');
  // The new sub-group inherits the parent's op (no auto-flip). It contains
  // the target + dragged chips and persists because flattenSameOp isn't run
  // on grouping operations.
  const subGroup = tree.children.find(c => c.type === 'group');
  if (!subGroup || subGroup.type !== 'group') throw new Error('expected a sub-group child');
  expect(subGroup.op).toBe('AND');
  const keys = subGroup.children.map(c => (c.type === 'filter' ? c.key : '(group)')).sort();
  expect(keys).toEqual(['priority', 'ticket_type']);
});

test('dragging onto an op-badge does not move or group anything', async ({ page }) => {
  await page.goto(
    entitiesUrl('jira_ticket', [
      leaf('ticket_type', 'eq', 'Story'),
      leaf('status', 'eq', 'open'),
      leaf('priority', 'eq', 'high'),
    ])
  );

  const dragged = page.locator('.filter-chip[data-filter-key="priority"]');
  const badge = page.locator('[data-filter-tree-root] .filter-op-badge').first();

  const urlBefore = page.url();
  await dragged.dragTo(badge);

  // The tree shouldn't have changed — give the auto-apply path a beat to fire
  // if it were going to, then confirm the URL is still what it was.
  await page.waitForTimeout(200);
  expect(page.url()).toBe(urlBefore);
});

test('shift-click selection + Group as OR wraps the chips in an OR sub-group', async ({ page }) => {
  await page.goto(
    entitiesUrl('jira_ticket', [
      leaf('ticket_type', 'eq', 'Story'),
      leaf('status', 'eq', 'open'),
      leaf('priority', 'eq', 'high'),
    ])
  );

  const toolbar = page.locator('[data-filter-selection-toolbar]');
  await expect(toolbar).toBeHidden();

  // Shift-click two chips.
  await page.locator('.filter-chip[data-filter-key="ticket_type"]').click({ modifiers: ['Shift'] });
  await page.locator('.filter-chip[data-filter-key="priority"]').click({ modifiers: ['Shift'] });
  await expect(toolbar).toBeVisible();

  await toolbar.locator('[data-group-as="OR"]').click();

  // Auto-apply: wait for the OR sub-group to appear in the URL tree.
  await expect
    .poll(
      () =>
        decodeTreeFromUrl(page.url())?.children.some(c => c.type === 'group' && c.op === 'OR') ??
        false
    )
    .toBe(true);
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.op).toBe('AND');
  // Find the OR child — should contain ticket_type and priority.
  const orChild = tree.children.find(c => c.type === 'group' && c.op === 'OR');
  if (!orChild || orChild.type !== 'group') throw new Error('expected an OR sub-group child');
  const orKeys = orChild.children.map(c => (c.type === 'filter' ? c.key : '(group)')).sort();
  expect(orKeys).toEqual(['priority', 'ticket_type']);
});
