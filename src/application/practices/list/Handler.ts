import type { Practice, PracticesRepository } from '../Repository';
import type { Request } from './Request';

export interface Response {
  practices: Practice[];
}

export function create(practicesRepo: PracticesRepository) {
  return async function handle(_req: Request): Promise<Response> {
    const practices = await practicesRepo.listAll();
    return { practices };
  };
}
