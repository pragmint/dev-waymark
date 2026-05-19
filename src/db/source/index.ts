import type { SourceDataAdapter } from './adapter';
import { createEntityRepository } from '../entityRepository';
import type { EntityRepository } from '../entityRepository';

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
