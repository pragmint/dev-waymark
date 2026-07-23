import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { invalidateCardCache } from './dashboardsHandler';
import { WaymarkInputSchema } from '../schemas/waymark';
import type { WaymarkInput } from '../schemas/waymark';

// Shared by create and update: parses and validates a waymark request body.
// Returns `response` (an error to return as-is) on failure.
async function parseWaymarkInput(
  c: Context
): Promise<{ response: Response } | { input: WaymarkInput }> {
  const body = await c.req.json<unknown>();
  const parsed = WaymarkInputSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: c.json({ error: 'Invalid waymark', details: parsed.error.issues }, 400),
    };
  }
  return { input: parsed.data };
}

export async function waymarksListApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viz = await repo.getVisualization(id);
  if (!viz) return c.json({ error: 'Not found' }, 404);

  const waymarks = await repo.listWaymarksForVisualization(id);
  return c.json({ waymarks, smoothingEnabled: !!viz.config.smoothing });
}

export async function waymarkCreateApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viz = await repo.getVisualization(id);
  if (!viz) return c.json({ error: 'Not found' }, 404);

  const parsed = await parseWaymarkInput(c);
  if ('response' in parsed) return parsed.response;

  const waymarkId = await repo.createWaymark(id, parsed.input);
  invalidateCardCache();
  return c.json({ id: waymarkId });
}

export async function waymarkUpdateApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const parsed = await parseWaymarkInput(c);
  if ('response' in parsed) return parsed.response;

  await repo.updateWaymark(id, parsed.input);
  invalidateCardCache();
  return c.json({ id });
}

export async function waymarkDeleteApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await repo.deleteWaymark(id);
  invalidateCardCache();
  return c.body(null, 204);
}
