import type { SourceDataAdapter, SqlParam } from './source/adapter';
import { EntitySchema, MetadataSchema, MetadataValueTypeSchema } from '../schemas/entity';
import type {
  Entity,
  Metadata,
  MetadataValueType,
  EntityWithMetadata,
  MetaFilter,
  AvailableFilter,
} from '../schemas/entity';

type WhereResult = { where: string; params: SqlParam[] };
type BuildState = { conditions: string[]; params: SqlParam[] };

type EntityFieldConfig = {
  column: string;
  value_type: MetadataValueType;
  getValue: (entity: EntityWithMetadata) => string;
  withDistinctValues?: boolean;
};

// Virtual filter keys that map directly to columns on the entities table.
// Extend this map to expose additional entity fields as filterable.
const ENTITY_FIELDS: Record<string, EntityFieldConfig> = {
  entity_name: { column: 'name', value_type: 'string', getValue: e => e.name },
  entity_type: {
    column: 'type',
    value_type: 'string',
    getValue: e => e.type,
    withDistinctValues: true,
  },
  entity_created_at: { column: 'created_at', value_type: 'date', getValue: e => e.created_at },
};

function addEntityFieldEqConditions(state: BuildState, column: string, values: string[]) {
  const { conditions, params } = state;
  if (values.length === 1) {
    params.push(values[0]);
    conditions.push(`e.${column} = ?`);
  } else {
    const placeholders = values.map(() => '?').join(', ');
    values.forEach(v => params.push(v));
    conditions.push(`e.${column} IN (${placeholders})`);
  }
}

function addEqConditions(state: BuildState, key: string, values: string[]) {
  const { conditions, params } = state;
  if (values.length === 1) {
    params.push(key, values[0]);
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value = ?)`
    );
  } else {
    const placeholders = values.map(() => '?').join(', ');
    params.push(key);
    values.forEach(v => params.push(v));
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value IN (${placeholders}))`
    );
  }
}

function addRangeOrContainsCondition(state: BuildState, f: MetaFilter) {
  const { conditions, params } = state;

  const entityField = ENTITY_FIELDS[f.key];
  if (entityField) {
    if (f.op === 'contains') {
      params.push(`%${f.value}%`);
      conditions.push(`e.${entityField.column} LIKE ?`);
    }
    // gte/lte on entity fields: not meaningful, skip
    return;
  }

  if (f.op === 'contains') {
    params.push(f.key, `%${f.value}%`);
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value LIKE ?)`
    );
  } else if (f.op === 'gte') {
    params.push(f.key, f.value, f.value);
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND ` +
        `(value_type = 'number' AND CAST(value AS REAL) >= CAST(? AS REAL) OR value_type != 'number' AND value >= ?))`
    );
  } else if (f.op === 'lte') {
    params.push(f.key, f.value, f.value);
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND ` +
        `(value_type = 'number' AND CAST(value AS REAL) <= CAST(? AS REAL) OR value_type != 'number' AND value <= ?))`
    );
  }
}

// Builds the SQL WHERE clause for all non-regex filters.
// `re` filters are handled in application code after the query.
function buildWhereClause(metaFilters: MetaFilter[]): WhereResult {
  const state: BuildState = { conditions: [], params: [] };

  // Group eq filters by key so multiple selections become a single IN clause (OR within key).
  const eqByKey = new Map<string, string[]>();
  const otherFilters: MetaFilter[] = [];
  for (const f of metaFilters) {
    if (f.op === 'eq') {
      if (!eqByKey.has(f.key)) eqByKey.set(f.key, []);
      eqByKey.get(f.key)!.push(f.value);
    } else if (f.op !== 're') {
      otherFilters.push(f);
    }
  }

  for (const [key, values] of eqByKey) {
    const entityField = ENTITY_FIELDS[key];
    if (entityField) {
      addEntityFieldEqConditions(state, entityField.column, values);
    } else {
      addEqConditions(state, key, values);
    }
  }
  for (const f of otherFilters) {
    addRangeOrContainsCondition(state, f);
  }

  return {
    where: state.conditions.length > 0 ? `WHERE ${state.conditions.join(' AND ')}` : '',
    params: state.params,
  };
}

// Apply regex (re) filters in application code after the SQL query.
function applyReFilters(
  entities: EntityWithMetadata[],
  metaFilters: MetaFilter[]
): EntityWithMetadata[] {
  const reFilters = metaFilters.filter(f => f.op === 're');
  if (reFilters.length === 0) return entities;

  return entities.filter(entity =>
    reFilters.every(f => {
      const entityField = ENTITY_FIELDS[f.key];
      const val = entityField
        ? entityField.getValue(entity)
        : entity.metadata.find(m => m.key === f.key)?.value;
      if (!val) return false;
      try {
        return new RegExp(f.value).test(val);
      } catch {
        return false;
      }
    })
  );
}

async function attachMetadata(
  adapter: SourceDataAdapter,
  entities: Entity[]
): Promise<EntityWithMetadata[]> {
  if (entities.length === 0) return [];

  const placeholders = entities.map(() => '?').join(',');
  const metaRows = await adapter.query(
    `SELECT * FROM entity_metadata WHERE entity_id IN (${placeholders}) ORDER BY key`,
    entities.map(e => e.id)
  );
  const allMetadata = metaRows.map(m => MetadataSchema.parse(m));

  const metaByEntityId = new Map<number, typeof allMetadata>();
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

export function createEntityRepository(adapter: SourceDataAdapter) {
  return {
    async list(metaFilters: MetaFilter[]): Promise<EntityWithMetadata[]> {
      const { where, params } = buildWhereClause(metaFilters);
      const rows = await adapter.query(
        `SELECT * FROM entities e ${where} ORDER BY e.id DESC`,
        params
      );
      const entities = rows.map(row => EntitySchema.parse(row));
      const withMeta = await attachMetadata(adapter, entities);
      return applyReFilters(withMeta, metaFilters);
    },

    async get(id: number): Promise<EntityWithMetadata | null> {
      const rows = await adapter.query('SELECT * FROM entities WHERE id = ?', [id]);
      if (rows.length === 0) return null;

      const metaRows = await adapter.query(
        'SELECT * FROM entity_metadata WHERE entity_id = ? ORDER BY key',
        [id]
      );

      return {
        ...EntitySchema.parse(rows[0]),
        metadata: metaRows.map(m => MetadataSchema.parse(m)),
      };
    },

    // Returns available filter metadata keys for the given set of matched entity IDs.
    // Accepts the already-filtered entity list so reactive narrowing is always exact.
    async getAvailableFilters(entityIds: number[]): Promise<AvailableFilter[]> {
      if (entityIds.length === 0) return [];

      const placeholders = entityIds.map(() => '?').join(', ');
      const rows = await adapter.query<{ key: string; value_type: string; value: string }>(
        `SELECT em.key, em.value_type, em.value
         FROM entity_metadata em
         WHERE em.entity_id IN (${placeholders})
         AND em.value IS NOT NULL
         ORDER BY em.key, em.value`,
        entityIds
      );

      const byKey = new Map<string, { value_type: string; values: Set<string> }>();
      for (const row of rows) {
        if (!byKey.has(row.key)) {
          byKey.set(row.key, { value_type: row.value_type, values: new Set() });
        }
        byKey.get(row.key)!.values.add(row.value);
      }

      const metaFilters = Array.from(byKey.entries()).map(([key, { value_type, values }]) => {
        const parsed = MetadataValueTypeSchema.safeParse(value_type);
        const vt = parsed.success ? parsed.data : ('string' as const);
        const filter: AvailableFilter = { key, value_type: vt };
        if (vt === 'string' && values.size <= 20) {
          filter.distinctValues = Array.from(values).sort();
        }
        return filter;
      });
      const entityFieldFilters: AvailableFilter[] = [];
      for (const [key, config] of Object.entries(ENTITY_FIELDS)) {
        const filter: AvailableFilter = { key, value_type: config.value_type };
        if (config.withDistinctValues) {
          const rows = await adapter.query<{ val: string }>(
            `SELECT DISTINCT ${config.column} AS val FROM entities WHERE id IN (${placeholders}) AND ${config.column} != '' ORDER BY ${config.column}`,
            entityIds
          );
          filter.distinctValues = rows.map(r => r.val);
        }
        entityFieldFilters.push(filter);
      }

      return [...entityFieldFilters, ...metaFilters];
    },

    async upsert(entity: Entity, metadata: Metadata[]): Promise<void> {
      await adapter.execute(
        `INSERT INTO entities (id, name, type)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           type = excluded.type`,
        [entity.id, entity.name, entity.type]
      );

      for (const m of metadata) {
        await adapter.execute(
          `INSERT INTO entity_metadata (entity_id, key, value, value_type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(entity_id, key) DO UPDATE SET
             value = excluded.value,
             value_type = excluded.value_type,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
          [m.entity_id, m.key, m.value ?? null, m.value_type]
        );
      }
    },
  };
}
