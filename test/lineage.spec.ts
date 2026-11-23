import { test, expect } from './strictTest';
import { LINEAGE_FIXTURE } from '../src/db/source/lineageFixture';

// Serves a small pipeline run through the DuckDB adapter instead of the e2e seed.
test.use({ sourceFixture: 'lineage' });

test('clicks from an entity straight to the raw Jira issue it was read from', async ({ page }) => {
  const [ticketId] = LINEAGE_FIXTURE.ticketIds;
  const [jiraDltId] = LINEAGE_FIXTURE.jiraDltIds;

  await page.goto(`/entities/${ticketId}`);
  await page.getByRole('link', { name: 'Trace lineage' }).click();
  await expect(page.locator('h1')).toContainText('entities');

  // No table sits between an entity and what its job read. Its dlt id holds `+` and `/`.
  const rawGroup = page.locator('[data-lineage-group="raw.jira_issues"]');
  await expect(rawGroup.locator('.badge')).toHaveText('raw');
  await rawGroup.locator('a.entity-link', { hasText: jiraDltId }).click();
  await expect(page.locator('h1')).toContainText(`raw.jira_issues ${jiraDltId}`);
  await expect(page.locator('.badge', { hasText: 'raw record' })).toBeVisible();

  const record = JSON.parse((await page.locator('[data-raw-record]').textContent()) ?? '{}');
  expect(record.key).toBe('DEMO-1');
  expect(record.fields.summary).toBe('Fix the thing');
});

test('expands an aggregate entity to every raw record behind it', async ({ page }) => {
  await page.goto(`/lineage/entities/${LINEAGE_FIXTURE.leadTimeId}`);
  // It read the tickets' and the change's metadata, and lineage names the entities themselves.
  await expect(page.locator('[data-lineage-group="entity_metadata"]')).toHaveCount(0);
  await expect(page.locator('[data-lineage-group="entities"] .count')).toHaveText('3 rows');

  await page.getByRole('link', { name: 'Expand to raw' }).click();
  await expect(page.locator('h1')).toHaveText('Raw records');
  await expect(page.locator('.lineage-hop-list li')).toHaveCount(3);

  const jira = page.locator('[data-lineage-group="raw.jira_issues"] tbody tr');
  await expect(jira).toHaveCount(2);
  await expect(page.locator('[data-lineage-group="raw.github_pulls"] tbody tr')).toHaveCount(1);
});

test('returns 404 for an unknown table or row', async ({ page }) => {
  expect((await page.goto('/lineage/nope/1'))?.status()).toBe(404);
  expect((await page.goto('/lineage/entities/404'))?.status()).toBe(404);
  expect((await page.goto('/lineage/entities/not-a-number'))?.status()).toBe(404);
});

test('narrows an aggregate to the sources one field reads, down to raw', async ({ page }) => {
  await page.goto(`/lineage/entities/${LINEAGE_FIXTURE.leadTimeId}`);
  await page.getByRole('link', { name: 'name', exact: true }).click();

  // The name reads only the tickets' issue_type, not the change's number.
  await expect(page.locator('[data-lineage-field="name"]')).toContainText(
    'entities[type=ticket].issue_type'
  );
  const tickets = page.locator('[data-lineage-group="entities"]');
  await expect(tickets.locator('.count')).toHaveText('2 rows');
  await expect(tickets.locator('th.lineage-col--field')).toHaveText('issue_type');
  await expect(tickets.locator('td.lineage-col--field').first()).toHaveText('Task');

  await page.getByRole('link', { name: 'Expand this field to raw' }).click();
  await expect(page.locator('[data-lineage-field="name"]')).toContainText(
    'raw.jira_issues.fields:$.issuetype.name'
  );
  await expect(page.locator('[data-lineage-group="raw.github_pulls"]')).toHaveCount(0);

  // The JSON path is pulled out of the raw record as its own column.
  const jira = page.locator('[data-lineage-group="raw.jira_issues"]');
  await expect(jira.locator('th.lineage-col--field')).toHaveText('fields:$.issuetype.name');
  await expect(jira.locator('td.lineage-col--field').first()).toHaveText('Task');
});

test('traces an entity’s metadata value from the entity to its raw field', async ({ page }) => {
  await page.goto(`/lineage/entities/${LINEAGE_FIXTURE.changeId}`);
  // Metadata shows as the entity's own fields, each with its own lineage.
  await page.getByRole('link', { name: 'number', exact: true }).click();

  await expect(page.locator('[data-lineage-field="number"]')).toContainText(
    'raw.github_pulls.number'
  );
  await expect(page.locator('[data-lineage-group="raw.github_pulls"] .count')).toHaveText('1 row');
  await expect(page.locator('[data-lineage-group="entity_metadata"]')).toHaveCount(0);
});
