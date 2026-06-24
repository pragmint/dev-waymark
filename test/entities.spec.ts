import { test, expect } from '@playwright/test';
import { decodeTreeFromUrl, entitiesUrl, leaf } from './treeUrl';

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

test('filter chip: click opens popover editor, × marks results as stale', async ({ page }) => {
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
  await expect(page.locator('body.filter-results-stale')).toHaveCount(0);

  // × removes the chip from the in-memory tree → results turn stale + Apply appears.
  await chip.locator('.filter-chip-x').click();
  await expect(chip).toHaveCount(0);
  await expect(page.locator('body.filter-results-stale')).toBeAttached();
  await expect(page.locator('[data-filter-apply]')).toBeVisible();
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

test('editing a regex filter prefills the regex input and opens that mode', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [leaf('ticket_type', 're', 'Story|Bug')]));

  const chip = page.locator('.filter-chip[data-filter-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();

  const editor = page.locator('[data-leaf-editor]');
  await expect(editor.locator('[data-active-mode]')).toHaveAttribute('data-active-mode', 'regex');
  await expect(editor.locator('input[data-op="re"]')).toHaveValue('Story|Bug');
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
  await page.locator('[data-filter-apply]').click();

  // After Apply, the URL's f tree should put status first, then ticket_type,
  // then priority — and the root group must still be AND (no new group).
  await page.waitForURL(/f=/);
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.op).toBe('AND');
  const keys = tree.children.map(c => (c.type === 'filter' ? c.key : '(group)'));
  // entity_type stays at the front (server-merged), then user-visible order.
  expect(keys).toEqual(['entity_type', 'status', 'ticket_type', 'priority']);
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
  await page.locator('[data-filter-apply]').click();

  await page.waitForURL(/f=/);
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

  await dragged.dragTo(badge);

  // The tree shouldn't have changed → Apply button stays hidden.
  await expect(page.locator('[data-filter-apply]')).toBeHidden();
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
  await page.locator('[data-filter-apply]').click();

  await page.waitForURL(/f=/);
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.op).toBe('AND');
  // Find the OR child — should contain ticket_type and priority.
  const orChild = tree.children.find(c => c.type === 'group' && c.op === 'OR');
  if (!orChild || orChild.type !== 'group') throw new Error('expected an OR sub-group child');
  const orKeys = orChild.children.map(c => (c.type === 'filter' ? c.key : '(group)')).sort();
  expect(orKeys).toEqual(['priority', 'ticket_type']);
});
