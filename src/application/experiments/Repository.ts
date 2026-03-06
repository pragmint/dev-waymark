import type { Experiment } from '../../schemas/experimentSchemas';

export interface ExperimentsRepository {
  listAll(): Promise<Experiment[]>;
}
