import { test, expect } from '@playwright/test';

// Each test saves a preset with a unique entity_name regex so its filter
// signature is one-of-a-kind — that way the "selected preset" matching is
// unambiguous even when other tests are creating presets in parallel.
function uniqueQuery(suffix: string): string {
  const tag = `__e2e_${suffix}_${Date.now()}_${Math.floor(Math.random() * 100000)}__`;
  return `mf__entity_type__eq=jira_ticket&mf__entity_name__re=${encodeURIComponent(tag)}`;
}

test('legacy /presets route is removed', async ({ request }) => {
  const res = await request.get('/presets', { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

test('entities page redirects to first entity type when none selected', async ({ page }) => {
  const res = await page.goto('/entities');
  await expect(page).toHaveURL(/mf__entity_type__eq=/);
  expect(res?.status()).toBeLessThan(400);
});

test('filter bar shows Type and Preset controls', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('[data-type-select]')).toBeVisible();
  // No preset selected by default → the plain select renders.
  await expect(page.locator('[data-preset-select]')).toBeVisible();
});

test('save preset: button reveals panel, cancel hides it', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('#save-preset-panel')).toBeHidden();
  await page.click('#save-preset-btn');
  await expect(page.locator('#save-preset-panel')).toBeVisible();
  await expect(page.locator('#save-preset-panel input[name="name"]')).toBeFocused();
  await page.click('#save-preset-cancel');
  await expect(page.locator('#save-preset-panel')).toBeHidden();
});

test('can save a preset and it appears selected', async ({ page }) => {
  const name = `E2E Save ${Date.now()}`;

  await page.goto(`/entities?${uniqueQuery('save')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  await expect(page).toHaveURL(/mf__entity_type__eq=/);
  // When a preset is selected the combobox renders with the preset's name.
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
});

test('loading a preset navigates to its filters', async ({ page }) => {
  const name = `E2E Load ${Date.now()}`;
  const presetUrl = `/entities?${uniqueQuery('load')}`;

  await page.goto(presetUrl);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  // Drop the regex filter from the URL so we're off the preset. Now no preset
  // is selected — the plain `<select>` renders with "None" checked.
  await page.goto('/entities?mf__entity_type__eq=jira_ticket');
  await expect(page.locator('[data-preset-select] option:checked')).toHaveText('None');

  // Selecting the preset from the select navigates back to its URL.
  await page.locator('[data-preset-select]').selectOption({ label: name });
  await expect(page).toHaveURL(/mf__entity_name__re=/);
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
});

test('rename a preset inline via the combobox', async ({ page }) => {
  const original = `E2E Rename ${Date.now()}`;
  const renamed = `${original} renamed`;

  await page.goto(`/entities?${uniqueQuery('rename')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', original);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  // After save the combobox renders with the preset's name.
  const input = page.locator('[data-preset-name-input]');
  await expect(input).toHaveValue(original);
  // Save changes / Revert are hidden until something changes.
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();

  // Typing into the name triggers draft state — Save changes appears.
  await input.fill(renamed);
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await expect(page.locator('[data-preset-revert]')).toBeVisible();

  // Submit; combobox now shows the new name and draft is gone.
  await page.locator('[data-preset-save-submit]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(renamed);
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
});

test('combobox toggle opens a list of other presets', async ({ page }) => {
  const a = `E2E A ${Date.now()}`;
  const b = `E2E B ${Date.now()}`;

  // Create two presets with distinct filter signatures.
  await page.goto(`/entities?${uniqueQuery('combo-a')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', a);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(a);

  await page.goto(`/entities?${uniqueQuery('combo-b')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', b);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(b);

  // Click the toggle — list opens, contains the other preset and "None".
  await page.locator('[data-preset-combo-toggle]').click();
  const list = page.locator('[data-preset-combo-list]');
  await expect(list).toBeVisible();
  await expect(list.locator('a', { hasText: 'None' })).toBeVisible();
  await expect(list.locator('a', { hasText: a })).toBeVisible();
});

test('delete preset: confirm dialog removes it', async ({ page }) => {
  const name = `E2E Delete ${Date.now()}`;

  await page.goto(`/entities?${uniqueQuery('delete')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  page.once('dialog', d => d.accept());
  await page.locator('[data-preset-delete-form] button[type="submit"]').click();

  // After delete, return_to brings us back to a URL without a preset — the
  // plain `<select>` renders again and the deleted option is gone.
  await expect(page.locator(`[data-preset-select] option:has-text("${name}")`)).toHaveCount(0);
});

test('save button is hidden when a preset is selected', async ({ page }) => {
  const name = `E2E SaveVis ${Date.now()}`;

  await page.goto(`/entities?${uniqueQuery('savevis')}`);
  // Unsaved state → button visible
  await expect(page.locator('#save-preset-btn')).toBeVisible();

  // Save the preset; combobox shows the preset's name
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  // With a preset selected, the Save button disappears
  await expect(page.locator('#save-preset-btn')).toHaveCount(0);

  // Selecting "None" via the combobox returns to unsaved state — Save reappears
  await page.locator('[data-preset-combo-toggle]').click();
  await page.locator('[data-preset-combo-list] a', { hasText: 'None' }).click();
  await expect(page.locator('#save-preset-btn')).toBeVisible();
});

test('changing entity type clears other filters', async ({ page }) => {
  const tag = `__e2e_typeswitch_${Date.now()}__`;

  // Start on jira_ticket with one extra filter
  await page.goto(
    `/entities?mf__entity_type__eq=jira_ticket&mf__entity_name__re=${encodeURIComponent(tag)}`
  );
  await expect(page.locator('.filter-chip[data-filter-edit-key="entity_name"]')).toBeVisible();

  // Switch type via the dropdown
  await page.locator('[data-type-select]').selectOption('github_pr');

  // Only the new entity_type filter survives — chip is gone
  await expect(page).toHaveURL('/entities?mf__entity_type__eq=github_pr');
  await expect(page.locator('.filter-chip[data-filter-edit-key="entity_name"]')).toHaveCount(0);
});

test('selecting "None" via the combobox clears preset + filters', async ({ page }) => {
  const name = `E2E Clear ${Date.now()}`;

  await page.goto(`/entities?${uniqueQuery('clear')}`);
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  // Open the combobox popup and click None.
  await page.locator('[data-preset-combo-toggle]').click();
  await page.locator('[data-preset-combo-list] a', { hasText: 'None' }).click();

  await expect(page).toHaveURL('/entities?mf__entity_type__eq=jira_ticket');
  await expect(page.locator('[data-preset-select] option:checked')).toHaveText('None');
});

test('modifying filters while a preset is selected enters draft state', async ({ page }) => {
  const name = `E2E Draft ${Date.now()}`;
  const tag = `__e2e_draft_${Date.now()}__`;

  // Save a preset whose filters are unique to this test.
  await page.goto(
    `/entities?mf__entity_type__eq=jira_ticket&mf__entity_name__re=${encodeURIComponent(tag)}`
  );
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page).toHaveURL(/preset=\d+/);

  // No draft state immediately after save — Save changes is hidden.
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();

  // Remove the regex filter via its chip ×. Preset stays selected (draft).
  await page.locator('.filter-chip[data-filter-edit-key="entity_name"] .filter-chip-x').click();

  // URL still carries preset=N; combobox still shows the saved name; Save
  // changes button (the amber attention variant) is now visible.
  await expect(page).toHaveURL(/preset=\d+/);
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page.locator('[data-preset-save-submit].filter-btn-attention')).toBeVisible();

  // Revert restores the saved filters — chip returns, button hidden again.
  await page.locator('[data-preset-revert]').click();
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page.locator('.filter-chip[data-filter-edit-key="entity_name"]')).toBeVisible();

  // Re-enter draft, then commit with Save changes instead of reverting.
  await page.locator('.filter-chip[data-filter-edit-key="entity_name"] .filter-chip-x').click();
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await page.locator('[data-preset-save-submit]').click();

  // After save the preset's stored filters now equal the URL filters, so the
  // Save changes button hides again.
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page.locator('.filter-chip[data-filter-edit-key="entity_name"]')).toHaveCount(0);
});

test('rename + filter edit commit together in one Save changes', async ({ page }) => {
  const original = `E2E Both ${Date.now()}`;
  const renamed = `${original} v2`;
  const tag = `__e2e_both_${Date.now()}__`;

  await page.goto(
    `/entities?mf__entity_type__eq=jira_ticket&mf__entity_name__re=${encodeURIComponent(tag)}`
  );
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', original);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  // Make BOTH a name change and a filter change in the same session, then
  // commit. One Save changes should persist both.
  await page.locator('[data-preset-name-input]').fill(renamed);
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await page.locator('.filter-chip[data-filter-edit-key="entity_name"] .filter-chip-x').click();
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await page.locator('[data-preset-name-input]').fill(renamed);
  await page.locator('[data-preset-save-submit]').click();

  await expect(page.locator('[data-preset-name-input]')).toHaveValue(renamed);
  await expect(page.locator('.filter-chip[data-filter-edit-key="entity_name"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
});

test('nav bar has no Saved Presets link', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('a[href="/presets"]')).toHaveCount(0);
});
