import type { SourceDataAdapter } from './adapter';
import { createEntityRepository } from '../entityRepository';
import type { EntityRepository } from '../entityRepository';
import { createLineageRepository } from '../lineageRepository';
import type { LineageRepository } from '../lineageRepository';

let _adapter: SourceDataAdapter | null = null;

export function initSourceAdapter(adapter: SourceDataAdapter): void {
  _adapter = adapter;
}

export function getSourceAdapter(): SourceDataAdapter {
  if (!_adapter) {
    throw new Error('Source adapter not initialized. Call initSourceAdapter() at startup.');
  }
  return _adapter;
}

export function getEntityRepo(): EntityRepository {
  return createEntityRepository(getSourceAdapter());
}

/** Lineage over the source tables, or null when the source isn't a pipeline run. */
export function getLineageRepo(): LineageRepository | null {
  const adapter = getSourceAdapter();
  const tables = adapter.listLineageTables?.();
  return tables ? createLineageRepository(adapter, tables) : null;
}
