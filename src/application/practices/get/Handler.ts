import type { Practice, PracticesRepository } from '../Repository';
import { NotFoundError } from '../../../domain/errors';
import type { Request } from './Request';

export interface Response {
  practice: Practice;
}

export function create(practicesRepo: PracticesRepository) {
  return async function handle(req: Request): Promise<Response> {
    const practice = await practicesRepo.getById(req.practiceId);
    if (!practice) throw new NotFoundError('Practice', req.practiceId);
    return { practice };
  };
}
