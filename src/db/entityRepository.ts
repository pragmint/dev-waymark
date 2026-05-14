import type { Database } from 'bun:sqlite';
import { EntitySchema, MetadataSchema } from '../schemas/entity';
import type { Entity, Metadata, EntityWithMetadata, EntityFilters } from '../schemas/entity';

function buildListQuery(filters: EntityFilters): { sql: string; params: Record<string, string> } {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters.source) {
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = 'source' AND value = $source)`
    );
    params['$source'] = filters.source;
  }
  if (filters.type) {
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = 'type' AND value = $type)`
    );
    params['$type'] = filters.type;
  }
  if (filters.from) {
    conditions.push('e.created_at >= $from');
    params['$from'] = filters.from;
  }
  if (filters.to) {
    conditions.push('e.created_at <= $to');
    params['$to'] = filters.to;
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { sql: `SELECT * FROM entities e${where} ORDER BY e.created_at DESC`, params };
}

function attachMetadata(db: Database, entities: Entity[]): EntityWithMetadata[] {
  if (entities.length === 0) return [];

  const placeholders = entities.map(() => '?').join(',');
  const metaRows = db
    .query(`SELECT * FROM entity_metadata WHERE entity_id IN (${placeholders}) ORDER BY key`)
    .all(...entities.map(e => e.id)) as unknown[];
  const allMetadata = metaRows.map(m => MetadataSchema.parse(m));

  const metaByEntityId = new Map<string, Metadata[]>();
  for (const m of allMetadata) {
    if (!metaByEntityId.has(m.entity_id)) metaByEntityId.set(m.entity_id, []);
    metaByEntityId.get(m.entity_id)!.push(m);
  }

  return entities.map(entity => ({
    ...entity,
    metadata: metaByEntityId.get(entity.id) ?? [],
  }));
}

export type EntityRepository = ReturnType<typeof createEntityRepository>;

export function createEntityRepository(db: Database) {
  return {
    list(filters: EntityFilters): EntityWithMetadata[] {
      const { sql, params } = buildListQuery(filters);
      const rows = db.query(sql).all(params) as unknown[];
      const entities = rows.map(row => EntitySchema.parse(row));
      return attachMetadata(db, entities);
    },

    get(id: string): EntityWithMetadata | null {
      const row = db.query('SELECT * FROM entities WHERE id = ?').get(id) as unknown;
      if (!row) return null;

      const metaRows = db
        .query('SELECT * FROM entity_metadata WHERE entity_id = ? ORDER BY key')
        .all(id) as unknown[];

      return {
        ...EntitySchema.parse(row),
        metadata: metaRows.map(m => MetadataSchema.parse(m)),
      };
    },

    distinctSources(): string[] {
      const rows = db
        .query(
          `SELECT DISTINCT value FROM entity_metadata WHERE key = 'source' AND value IS NOT NULL ORDER BY value`
        )
        .all() as { value: string }[];
      return rows.map(r => r.value);
    },

    distinctTypes(): string[] {
      const rows = db
        .query(
          `SELECT DISTINCT value FROM entity_metadata WHERE key = 'type' AND value IS NOT NULL ORDER BY value`
        )
        .all() as { value: string }[];
      return rows.map(r => r.value);
    },

    upsert(entity: Entity, metadata: Metadata[]): void {
      db.query(
        `
        INSERT INTO entities (id, source_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          updated_at = excluded.updated_at
      `
      ).run(entity.id, entity.source_id, entity.created_at, entity.updated_at);

      for (const m of metadata) {
        db.query(
          `
          INSERT INTO entity_metadata (entity_id, key, value, value_type)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(entity_id, key) DO UPDATE SET
            value = excluded.value,
            value_type = excluded.value_type
        `
        ).run(m.entity_id, m.key, m.value ?? null, m.value_type);
      }
    },
  };
}
