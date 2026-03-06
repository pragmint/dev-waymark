import type { Context } from 'hono';
import { CapabilityCatalogPage } from '../../../frontend/Pages/CapabilityCatalogPage';
import type { Request } from '../../../application/capabilities/list/Request';
import type { Response } from '../../../application/capabilities/list/Handler';

export function create(handle: (req: Request) => Promise<Response>) {
  return async (c: Context) => {
    const result = await handle({});
    return c.html(<CapabilityCatalogPage allCapabilities={result.capabilities} />);
  };
}
