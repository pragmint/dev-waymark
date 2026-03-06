import type { Context } from 'hono';
import { PracticeDetailPage } from '../../../frontend/Pages/PracticeDetailPage';
import type { Response } from '../../../application/practices/get/Handler';
import type { Request } from '../../../application/practices/get/Request';

export function create(handle: (req: Request) => Promise<Response>) {
  return async (c: Context) => {
    const practiceId = c.req.param('practiceId');
    const result = await handle({ practiceId });
    return c.html(<PracticeDetailPage practice={result.practice} />);
  };
}
