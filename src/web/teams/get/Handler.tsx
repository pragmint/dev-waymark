import type { Context } from 'hono';
import { TeamDetailPage } from '../../../frontend/Pages/TeamDetailPage';
import type { TeamDetailPageProps } from '../../../frontend/Pages/TeamDetailPage';
import type { Request } from '../../../application/teams/get/Request';

export function create(handle: (req: Request) => Promise<TeamDetailPageProps>) {
  return async (c: Context) => {
    const teamId = c.req.param('teamId');
    const data = await handle({ teamId });
    return c.html(<TeamDetailPage {...data} />);
  };
}
