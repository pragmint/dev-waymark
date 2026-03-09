import type { Experiment } from '../schemas/experimentSchemas';
import { parseDate } from './parseDate';

export const EXPERIMENT_STATUS_SORT_ORDER = [
  'active',
  'blocked',
  'backlog',
  'polish',
  'pitch',
] as const satisfies readonly Experiment['status'][];

export const CHRONOLOGICAL_STATUSES: Experiment['status'][] = ['active', 'blocked', 'backlog'];

export function compareExperimentsByStatus(a: Experiment, b: Experiment): number {
  const statusDiff =
    EXPERIMENT_STATUS_SORT_ORDER.indexOf(a.status) - EXPERIMENT_STATUS_SORT_ORDER.indexOf(b.status);
  if (statusDiff !== 0) return statusDiff;

  const dateA = a.startDate ? parseDate(a.startDate).getTime() : 0;
  const dateB = b.startDate ? parseDate(b.startDate).getTime() : 0;

  if (CHRONOLOGICAL_STATUSES.includes(a.status)) {
    return dateA - dateB;
  }
  return dateB - dateA;
}
