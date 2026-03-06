import type { Context } from 'hono';
import { CapabilityDetailPage } from '../../../frontend/Pages/CapabilityDetailPage';
import type { Request } from '../../../application/capabilities/get/Request';
import type { Response } from '../../../application/capabilities/get/Handler';

export function create(handle: (req: Request) => Promise<Response>) {
  return async (c: Context) => {
    const capabilityId = c.req.param('capabilityId');
    const teamFilter = c.req.query('team') || 'all';

    const result = await handle({ capabilityId, teamFilter });

    if (result.teams.length === 1 && teamFilter === 'all') {
      return c.redirect(`/catalog/capability/${capabilityId}?team=${result.teams[0].id}`);
    }

    return c.html(
      <CapabilityDetailPage
        teams={result.teams}
        capability={result.capability}
        selectedTeam={result.selectedTeam}
        markdownContent={result.markdownContent}
      />
    );
  };
}
