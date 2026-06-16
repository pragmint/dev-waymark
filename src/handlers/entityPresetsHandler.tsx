import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { buildEntityUrl, parseFiltersFromForm } from '../domain/filterUrl';

export async function entityPresetsSaveHandler(c: Context) {
  const repo = getAppStateRepo();
  const formData = await c.req.formData();

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) return c.redirect('/entities');

  const filters = parseFiltersFromForm(formData);
  if (filters.length === 0) return c.redirect('/entities');

  const id = await repo.savePreset(name, filters);
  return c.redirect(buildEntityUrl(filters, id));
}

export async function entityPresetsUpdateHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.redirect('/entities');

  const formData = await c.req.formData();
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) return c.redirect('/entities');

  const filters = parseFiltersFromForm(formData);
  if (filters.length === 0) return c.redirect('/entities');

  const existing = await repo.getPreset(id);
  if (!existing) return c.redirect('/entities');

  await repo.updatePreset(id, name, filters);
  return c.redirect(buildEntityUrl(filters, id));
}

export async function entityPresetsDeleteHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);

  const formData = await c.req.formData();
  const returnTo = (formData.get('return_to') as string | null)?.trim();
  const target = returnTo && returnTo.startsWith('/entities') ? returnTo : '/entities';

  if (!isNaN(id)) await repo.deletePreset(id);
  return c.redirect(target);
}
