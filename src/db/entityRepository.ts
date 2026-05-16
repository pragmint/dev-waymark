import type { Database } from 'bun:sqlite';
import { EntitySchema, MetadataSchema, MetadataValueTypeSchema } from '../schemas/entity';
import type {
  Entity,
  Metadata,
  EntityWithMetadata,
  MetaFilter,
  AvailableFilter,
} from '../schemas/entity';

type WhereResult = { where: string; params: Record<string, string | number> };
type BuildState = { conditions: string[]; params: Record<string, string | number>; i: number };

const ENTITY_NAME_KEY = 'entity_name';

function addEntityNameEqConditions(state: BuildState, values: string[]) {
  const { conditions, params } = state;
  if (values.length === 1) {
    const vi = `$v${state.i}`;
    params[vi] = values[0];
    conditions.push(`e.name = ${vi}`);
    state.i += 1;
  } else {
    const placeholders = values.map((_, j) => `$v${state.i + j}`).join(', ');
    values.forEach((v, j) => {
      params[`$v${state.i + j}`] = v;
    });
    conditions.push(`e.name IN (${placeholders})`);
    state.i += values.length;
  }
}

function addEqConditions(state: BuildState, key: string, values: string[]) {
  const { conditions, params } = state;
  const ki = `$k${state.i}`;
  params[ki] = key;
  if (values.length === 1) {
    const vi = `$v${state.i}`;
    params[vi] = values[0];
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ${ki} AND value = ${vi})`
    );
    state.i += 2;
  } else {
    const placeholders = values.map((_, j) => `$v${state.i + j}`).join(', ');
    values.forEach((v, j) => {
      params[`$v${state.i + j}`] = v;
    });
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ${ki} AND value IN (${placeholders}))`
    );
    state.i += 1 + values.length;
  }
}

function addRangeOrContainsCondition(state: BuildState, f: MetaFilter) {
  const { conditions, params } = state;
  const vi = `$v${state.i}`;

  if (f.key === ENTITY_NAME_KEY) {
    if (f.op === 'contains') {
      params[vi] = `%${f.value}%`;
      conditions.push(`e.name LIKE ${vi}`);
    }
    // gte/lte on entity_name: not meaningful, skip
    state.i += 2;
    return;
  }

  const ki = `$k${state.i}`;

  if (f.op === 'contains') {
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ${ki} AND value LIKE ${vi})`
    );
    params[ki] = f.key;
    params[vi] = `%${f.value}%`;
  } else if (f.op === 'gte') {
    const vi2 = `$v${state.i}b`;
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ${ki} AND ` +
        `(value_type = 'number' AND CAST(value AS REAL) >= CAST(${vi} AS REAL) OR value_type != 'number' AND value >= ${vi2}))`
    );
    params[ki] = f.key;
    params[vi] = f.value;
    params[vi2] = f.value;
  } else if (f.op === 'lte') {
    const vi2 = `$v${state.i}b`;
    conditions.push(
      `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ${ki} AND ` +
        `(value_type = 'number' AND CAST(value AS REAL) <= CAST(${vi} AS REAL) OR value_type != 'number' AND value <= ${vi2}))`
    );
    params[ki] = f.key;
    params[vi] = f.value;
    params[vi2] = f.value;
  }

  state.i += 2;
}

// Builds the SQL WHERE clause for all non-regex filters.
// `re` filters are handled in application code after the query.
function buildWhereClause(metaFilters: MetaFilter[]): WhereResult {
  const state: BuildState = { conditions: [], params: {}, i: 0 };

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
    if (key === ENTITY_NAME_KEY) {
      addEntityNameEqConditions(state, values);
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
      const val =
        f.key === ENTITY_NAME_KEY ? entity.name : entity.metadata.find(m => m.key === f.key)?.value;
      if (!val) return false;
      try {
        return new RegExp(f.value).test(val);
      } catch {
        return false;
      }
    })
  );
}

function attachMetadata(db: Database, entities: Entity[]): EntityWithMetadata[] {
  if (entities.length === 0) return [];

  const placeholders = entities.map(() => '?').join(',');
  const metaRows = db
    .query(`SELECT * FROM entity_metadata WHERE entity_id IN (${placeholders}) ORDER BY key`)
    .all(...entities.map(e => e.id)) as unknown[];
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

export function createEntityRepository(db: Database) {
  return {
    list(metaFilters: MetaFilter[]): EntityWithMetadata[] {
      const { where, params } = buildWhereClause(metaFilters);
      const rows = db
        .query(`SELECT * FROM entities e ${where} ORDER BY e.id DESC`)
        .all(params) as unknown[];
      const entities = rows.map(row => EntitySchema.parse(row));
      const withMeta = attachMetadata(db, entities);
      return applyReFilters(withMeta, metaFilters);
    },

    get(id: number): EntityWithMetadata | null {
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

    // Returns available filter metadata keys for the given set of matched entity IDs.
    // Accepts the already-filtered entity list so reactive narrowing is always exact.
    getAvailableFilters(entityIds: number[]): AvailableFilter[] {
      if (entityIds.length === 0) return [];

      const placeholders = entityIds.map(() => '?').join(', ');
      const rows = db
        .query(
          `SELECT em.key, em.value_type, em.value
           FROM entity_metadata em
           WHERE em.entity_id IN (${placeholders})
           AND em.value IS NOT NULL
           ORDER BY em.key, em.value`
        )
        .all(...entityIds) as { key: string; value_type: string; value: string }[];

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
      return [{ key: ENTITY_NAME_KEY, value_type: 'string' as const }, ...metaFilters];
    },

    upsert(entity: Entity, metadata: Metadata[]): void {
      db.query(
        `INSERT INTO entities (id, name)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name`
      ).run(entity.id, entity.name);

      for (const m of metadata) {
        db.query(
          `INSERT INTO entity_metadata (entity_id, key, value, value_type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(entity_id, key) DO UPDATE SET
             value = excluded.value,
             value_type = excluded.value_type`
        ).run(m.entity_id, m.key, m.value ?? null, m.value_type);
      }
    },
  };
}
