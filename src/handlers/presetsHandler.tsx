import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { MetaFilterOpSchema } from '../schemas/entity';
import type { MetaFilter } from '../schemas/entity';
import { PresetsPage } from '../frontend/Pages/PresetsPage';

const META_FILTER_RE = /^mf__(.+)__([a-z]+)$/;

function buildEntityUrl(filters: MetaFilter[]): string {
  const params = new URLSearchParams();
  for (const f of filters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

export async function presetsListHandler(c: Context) {
  const repo = getAppStateRepo();
  const presets = await repo.listPresets();

  const presetsWithUrls = await Promise.all(
    presets.map(async d => {
      const full = await repo.getPreset(d.id);
      return { ...d, url: full ? buildEntityUrl(full.filters) : '/entities' };
    })
  );

  return c.html(<PresetsPage presets={presetsWithUrls} />);
}

export async function presetsSaveHandler(c: Context) {
  const repo = getAppStateRepo();
  const formData = await c.req.formData();

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) return c.redirect('/entities');

  const metaFilters: MetaFilter[] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string' || !value) continue;
    const match = META_FILTER_RE.exec(key);
    if (!match) continue;
    const [, filterKey, opRaw] = match;
    const parsed = MetaFilterOpSchema.safeParse(opRaw);
    if (!parsed.success) continue;
    metaFilters.push({ key: filterKey, op: parsed.data, value });
  }

  await repo.savePreset(name, metaFilters);
  return c.redirect('/presets');
}

export async function presetsDeleteHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!isNaN(id)) await repo.deletePreset(id);
  return c.redirect('/presets');
}
