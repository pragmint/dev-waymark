import type { EntityWithMetadata } from '../schemas/entity';

export function getMetadataValue(
  entity: EntityWithMetadata,
  key: string
): string | null | undefined {
  return entity.metadata.find(m => m.key === key)?.value;
}

export function getEntityTitle(entity: EntityWithMetadata): string {
  return entity.name;
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
