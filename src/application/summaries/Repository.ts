import type { Summary } from '../../schemas/summarySchemas';

export interface SummariesRepository {
  listAll(): Promise<Summary[]>;
}
