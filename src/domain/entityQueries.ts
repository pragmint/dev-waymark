import type { Entity, EntityWithMetadata } from '../schemas/entity';

export function getMetadataValue(
  entity: EntityWithMetadata,
  key: string
): string | null | undefined {
  return entity.metadata.find(m => m.key === key)?.value;
}

export function getEntityTitle(entity: EntityWithMetadata): string {
  const source = getMetadataValue(entity, 'source');
  return source ? `${source}/${entity.source_id}` : entity.source_id;
}

export function sortEntitiesByDate<T extends Entity>(
  entities: T[],
  direction: 'asc' | 'desc'
): T[] {
  return [...entities].sort((a, b) => {
    const diff = a.created_at.localeCompare(b.created_at);
    return direction === 'asc' ? diff : -diff;
  });
}

export function groupEntitiesByType(
  entities: EntityWithMetadata[]
): Record<string, EntityWithMetadata[]> {
  return entities.reduce(
    (groups, entity) => {
      const type = getMetadataValue(entity, 'type') ?? '';
      if (!groups[type]) groups[type] = [];
      groups[type].push(entity);
      return groups;
    },
    {} as Record<string, EntityWithMetadata[]>
  );
}
