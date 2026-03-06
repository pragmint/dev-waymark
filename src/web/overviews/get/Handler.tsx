import type { Context } from 'hono';
import { OverviewPage } from '../../../frontend/Pages/OverviewPage';
import type { OverviewPageProps } from '../../../frontend/Pages/OverviewPage';
import type { Request } from '../../../application/overviews/get/Request';

export function create(handle: (req: Request) => Promise<OverviewPageProps>) {
  return async (c: Context) => {
    const date = c.req.param('date');
    const data = await handle({ date });
    return c.html(<OverviewPage {...data} />);
  };
}
