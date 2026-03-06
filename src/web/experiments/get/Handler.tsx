import type { Context } from 'hono';
import { ExperimentDetailPage } from '../../../frontend/Pages/ExperimentDetailPage';
import type { ExperimentDetailPageProps } from '../../../frontend/Pages/ExperimentDetailPage';
import type { Request } from '../../../application/experiments/get/Request';

export function create(handle: (req: Request) => Promise<ExperimentDetailPageProps>) {
  return async (c: Context) => {
    const experimentId = c.req.param('experimentId');
    const data = await handle({ experimentId });
    return c.html(<ExperimentDetailPage {...data} />);
  };
}
