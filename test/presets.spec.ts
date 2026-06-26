import { test, expect } from './strictTest';
import { decodeTreeFromUrl, entitiesUrl, leaf } from './treeUrl';

// Each test seeds a preset with a unique entity_name regex so the preset's
// filter signature is one-of-a-kind across parallel runs.
function uniqueTag(suffix: string): string {
  return `__e2e_${suffix}_${Date.now()}_${Math.floor(Math.random() * 100000)}__`;
}

function uniqueUrl(suffix: string): string {
  const tag = uniqueTag(suffix);
  return entitiesUrl('jira_ticket', [leaf('entity_name', 're', tag)]);
}

test('legacy /presets route is removed', async ({ request }) => {
  const res = await request.get('/presets', { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

test('entities page redirects to first entity type when none selected', async ({ page }) => {
  const res = await page.goto('/entities');
  // The handler seeds entity_type into the tree and redirects with the new f= format.
  await expect(page).toHaveURL(/f=/);
  const tree = decodeTreeFromUrl(page.url())!;
  expect(tree.children.some(c => c.type === 'filter' && c.key === 'entity_type')).toBe(true);
  expect(res?.status()).toBeLessThan(400);
});

test('filter bar shows Type and Preset controls', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('[data-entity-type-select]')).toBeVisible();
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

  await page.goto(uniqueUrl('save'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  await expect(page).toHaveURL(/f=/);
  // When a preset is selected the combobox renders with the preset's name.
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
});

test('loading a preset navigates to its filters', async ({ page }) => {
  const name = `E2E Load ${Date.now()}`;

  await page.goto(uniqueUrl('load'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  // Navigate to a URL with just entity_type — no preset matches, so the plain
  // `<select>` renders with "None".
  await page.goto(entitiesUrl('jira_ticket'));
  await expect(page.locator('[data-preset-select] option:checked')).toHaveText('None');

  await page.locator('[data-preset-select]').selectOption({ label: name });
  // Loading the preset navigates to its URL which includes the saved tree.
  await expect(page).toHaveURL(/f=/);
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
});

test('rename a preset inline via the combobox', async ({ page }) => {
  const original = `E2E Rename ${Date.now()}`;
  const renamed = `${original} renamed`;

  await page.goto(uniqueUrl('rename'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', original);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  const input = page.locator('[data-preset-name-input]');
  await expect(input).toHaveValue(original);
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();

  await input.fill(renamed);
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await expect(page.locator('[data-preset-revert]')).toBeVisible();

  await page.locator('[data-preset-save-submit]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(renamed);
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
});

test('combobox toggle opens a list of other presets', async ({ page }) => {
  const a = `E2E A ${Date.now()}`;
  const b = `E2E B ${Date.now()}`;

  await page.goto(uniqueUrl('combo-a'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', a);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(a);

  await page.goto(uniqueUrl('combo-b'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', b);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(b);

  await page.locator('[data-preset-combo-toggle]').click();
  const list = page.locator('[data-preset-combo-list]');
  await expect(list).toBeVisible();
  await expect(list.locator('a', { hasText: 'None' })).toBeVisible();
  await expect(list.locator('a', { hasText: a })).toBeVisible();
});

test('delete preset: confirm dialog removes it', async ({ page }) => {
  const name = `E2E Delete ${Date.now()}`;

  await page.goto(uniqueUrl('delete'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  page.once('dialog', d => d.accept());
  await page.locator('[data-preset-delete-form] button[type="submit"]').click();

  await expect(page.locator(`[data-preset-select] option:has-text("${name}")`)).toHaveCount(0);
});

test('save button is hidden when a preset is selected', async ({ page }) => {
  const name = `E2E SaveVis ${Date.now()}`;

  await page.goto(uniqueUrl('savevis'));
  await expect(page.locator('#save-preset-btn')).toBeVisible();

  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  await expect(page.locator('#save-preset-btn')).toHaveCount(0);

  await page.locator('[data-preset-combo-toggle]').click();
  await page.locator('[data-preset-combo-list] a', { hasText: 'None' }).click();
  await expect(page.locator('#save-preset-btn')).toBeVisible();
});

test('changing entity type clears other filters', async ({ page }) => {
  const tag = uniqueTag('typeswitch');

  await page.goto(entitiesUrl('jira_ticket', [leaf('entity_name', 're', tag)]));
  await expect(page.locator('.filter-chip[data-filter-key="entity_name"]')).toBeVisible();

  await page.locator('[data-entity-type-select]').selectOption('github_pr');

  // Type dropdown drives navigation: the URL switches to the new type and the
  // old chip is gone.
  await expect
    .poll(() => {
      const t = decodeTreeFromUrl(page.url());
      const et = t?.children.find(c => c.type === 'filter' && c.key === 'entity_type');
      return et && et.type === 'filter' ? et.value : null;
    })
    .toBe('github_pr');
  await expect(page.locator('.filter-chip[data-filter-key="entity_name"]')).toHaveCount(0);
});

test('selecting "None" via the combobox clears preset + filters', async ({ page }) => {
  const name = `E2E Clear ${Date.now()}`;

  await page.goto(uniqueUrl('clear'));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  await page.locator('[data-preset-combo-toggle]').click();
  await page.locator('[data-preset-combo-list] a', { hasText: 'None' }).click();

  // None leaves only entity_type in the tree.
  await expect(page.locator('[data-preset-select] option:checked')).toHaveText('None');
});

test('removing a chip from a selected preset enters draft state and Apply commits', async ({
  page,
}) => {
  const name = `E2E Draft ${Date.now()}`;
  const tag = uniqueTag('draft');

  await page.goto(entitiesUrl('jira_ticket', [leaf('entity_name', 're', tag)]));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page).toHaveURL(/preset=\d+/);

  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();

  // Remove the chip — auto-apply updates the URL; Save-changes appears because
  // the live tree no longer matches the pinned preset.
  await page.locator('.filter-chip[data-filter-key="entity_name"] .filter-chip-x').click();
  await expect(page.locator('.filter-chip[data-filter-key="entity_name"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-save-submit].filter-btn-attention')).toBeVisible();

  // Save-changes commits the modified tree under the same preset id.
  await page.locator('[data-preset-save-submit]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);
  await expect(page.locator('.filter-chip[data-filter-key="entity_name"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-save-submit]')).toBeHidden();
});

test('save as new: hidden until draft, then forks into a separate preset', async ({ page }) => {
  const original = `E2E SaveAsNew ${Date.now()}`;
  const fork = `${original} fork`;
  const tag = uniqueTag('saveasnew');

  await page.goto(entitiesUrl('jira_ticket', [leaf('entity_name', 're', tag)]));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', original);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(original);
  await expect(page).toHaveURL(/preset=\d+/);

  // Clean preset — Save-as-new is hidden along with Save-changes/Revert.
  await expect(page.locator('[data-preset-save-as-new]')).toBeHidden();

  // Enter draft by removing the chip; Save-as-new should now surface
  // alongside Save-changes.
  await page.locator('.filter-chip[data-filter-key="entity_name"] .filter-chip-x').click();
  await expect(page.locator('.filter-chip[data-filter-key="entity_name"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-save-submit]')).toBeVisible();
  await expect(page.locator('[data-preset-save-as-new]')).toBeVisible();

  // Clicking Save-as-new opens the save panel with an empty name field focused,
  // so the user picks a fresh name rather than overwriting the original.
  await page.locator('[data-preset-save-as-new]').click();
  await expect(page.locator('#save-preset-panel')).toBeVisible();
  const nameField = page.locator('#save-preset-panel input[name="name"]');
  await expect(nameField).toHaveValue('');
  await expect(nameField).toBeFocused();

  await nameField.fill(fork);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  // New preset is selected with the modified tree; original preset still exists.
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(fork);
  await expect(page).toHaveURL(/preset=\d+/);
  await expect(page.locator('[data-preset-save-as-new]')).toBeHidden();

  await page.locator('[data-preset-combo-toggle]').click();
  await expect(page.locator('[data-preset-combo-list] a', { hasText: original })).toBeVisible();
});

test('save changes button has no decorative dot', async ({ page }) => {
  const name = `E2E NoDot ${Date.now()}`;
  const tag = uniqueTag('nodot');

  await page.goto(entitiesUrl('jira_ticket', [leaf('entity_name', 're', tag)]));
  await page.click('#save-preset-btn');
  await page.fill('#save-preset-panel input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page.locator('[data-preset-name-input]')).toHaveValue(name);

  // Enter draft state to make Save-changes visible.
  await page.locator('.filter-chip[data-filter-key="entity_name"] .filter-chip-x').click();
  const saveChanges = page.locator('[data-preset-save-submit]');
  await expect(saveChanges).toBeVisible();
  await expect(saveChanges.locator('.filter-btn-dot')).toHaveCount(0);
});

test('nav bar has no Saved Presets link', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('a[href="/presets"]')).toHaveCount(0);
});
