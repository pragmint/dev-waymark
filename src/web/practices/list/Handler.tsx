import type { Context } from 'hono';
import { PracticesCatalogPage } from '../../../frontend/Pages/PracticesCatalogPage';
import type { Request } from '../../../application/practices/list/Request';
import type { Response } from '../../../application/practices/list/Handler';

export function create(handle: (req: Request) => Promise<Response>) {
  return async (c: Context) => {
    const result = await handle({});
    return c.html(<PracticesCatalogPage practices={result.practices} />);
  };
}
