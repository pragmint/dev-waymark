import type { Experiment } from '../schemas/experimentSchemas';
import { parseDate } from './parseDate';

export function compareExperimentsByStatus(a: Experiment, b: Experiment): number {
  const order = ['active', 'blocked', 'backlog', 'polish', 'pitch'] as const;
  const statusDiff = order.indexOf(a.status) - order.indexOf(b.status);
  if (statusDiff !== 0) return statusDiff;

  const dateA = a.startDate ? parseDate(a.startDate).getTime() : 0;
  const dateB = b.startDate ? parseDate(b.startDate).getTime() : 0;

  const chronologicalStatuses = ['active', 'blocked', 'backlog'];
  if (chronologicalStatuses.includes(a.status)) {
    return dateA - dateB;
  }
  return dateB - dateA;
}
