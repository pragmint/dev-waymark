import type { SourceDataAdapter, SqlParam } from './source/adapter';
import { EntitySchema, MetadataSchema, MetadataValueTypeSchema } from '../schemas/entity';
import type {
  Entity,
  Metadata,
  MetadataValueType,
  EntityWithMetadata,
  AvailableFilter,
} from '../schemas/entity';
import { isGroup, isLeaf, canonicalizeTree } from '../schemas/filterTree';
import type { FilterLeaf, FilterNode, FilterTree } from '../schemas/filterTree';
import { createTtlCache } from './queryCache';
import type { TtlCache } from './queryCache';

type WhereResult = { where: string; params: SqlParam[] };

type EntityFieldConfig = {
  column: string;
  value_type: MetadataValueType;
  withDistinctValues?: boolean;
};

// Virtual filter keys that map directly to columns on the entities table.
// Extend this map to expose additional entity fields as filterable.
const ENTITY_FIELDS: Record<string, EntityFieldConfig> = {
  entity_name: { column: 'name', value_type: 'string' },
  entity_type: { column: 'type', value_type: 'string', withDistinctValues: true },
  entity_created_at: { column: 'created_at', value_type: 'date' },
};

type SqlFragment = { sql: string; params: SqlParam[] };

function eqSql(leaf: FilterLeaf, entityField: EntityFieldConfig | undefined): SqlFragment {
  const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  if (values.length === 0) return { sql: '1=0', params: [] };
  const placeholders = values.map(() => '?').join(', ');
  if (entityField) {
    const sql =
      values.length === 1
        ? `e.${entityField.column} = ?`
        : `e.${entityField.column} IN (${placeholders})`;
    return { sql, params: values };
  }
  const sql =
    values.length === 1
      ? `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value = ?)`
      : `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value IN (${placeholders}))`;
  return { sql, params: [leaf.key, ...values] };
}

function containsSql(
  leaf: FilterLeaf,
  value: string,
  entityField: EntityFieldConfig | undefined
): SqlFragment {
  if (entityField) {
    return { sql: `e.${entityField.column} LIKE ?`, params: [`%${value}%`] };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value LIKE ?)`,
    params: [leaf.key, `%${value}%`],
  };
}

function rangeSql(
  leaf: FilterLeaf,
  value: string,
  entityField: EntityFieldConfig | undefined,
  cmp: '>=' | '<='
): SqlFragment {
  if (value === '') {
    // Empty bound carries IS NULL semantics — match entities with no value.
    if (entityField) {
      return { sql: `e.${entityField.column} IS NULL`, params: [] };
    }
    return {
      sql: `NOT EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value IS NOT NULL)`,
      params: [leaf.key],
    };
  }
  if (entityField) {
    return { sql: `e.${entityField.column} ${cmp} ?`, params: [value] };
  }
  // Only include the numeric-cast branch when the bound parses as a finite
  // number — otherwise `CAST('2024-01-05' AS REAL)` errors in Postgres
  // (SQLite silently coerces to 0/2024, but that's meaningless anyway).
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== '') {
    return {
      sql:
        `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND ` +
        `((value_type = 'number' AND CAST(value AS REAL) ${cmp} ?) OR (value_type != 'number' AND value ${cmp} ?)))`,
      params: [leaf.key, numeric, value],
    };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value_type != 'number' AND value ${cmp} ?)`,
    params: [leaf.key, value],
  };
}

function exactSql(
  leaf: FilterLeaf,
  value: string,
  entityField: EntityFieldConfig | undefined
): SqlFragment {
  if (entityField) {
    return { sql: `e.${entityField.column} = ?`, params: [value] };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM entity_metadata WHERE entity_id = e.id AND key = ? AND value = ?)`,
    params: [leaf.key, value],
  };
}

function leafSql(leaf: FilterLeaf): SqlFragment {
  const entityField = ENTITY_FIELDS[leaf.key];
  if (leaf.op === 'eq') return eqSql(leaf, entityField);
  const value = Array.isArray(leaf.value) ? (leaf.value[0] ?? '') : leaf.value;
  if (leaf.op === 'contains') return containsSql(leaf, value, entityField);
  if (leaf.op === 'exact') return exactSql(leaf, value, entityField);
  if (leaf.op === 'gte') return rangeSql(leaf, value, entityField, '>=');
  if (leaf.op === 'lte') return rangeSql(leaf, value, entityField, '<=');
  return { sql: '1=1', params: [] };
}

function nodeSql(node: FilterNode): SqlFragment {
  if (isLeaf(node)) return leafSql(node);
  if (!isGroup(node)) return { sql: '1=1', params: [] };
  if (node.children.length === 0) return { sql: '1=1', params: [] };

  if (node.op === 'NOT') {
    const child = nodeSql(node.children[0]);
    return { sql: `NOT (${child.sql})`, params: child.params };
  }

  const childResults = node.children.map(nodeSql);
  if (childResults.length === 1) return childResults[0];

  const joiner = node.op === 'AND' ? ' AND ' : ' OR ';
  const sql = `(${childResults.map(r => r.sql).join(joiner)})`;
  const params = childResults.flatMap(r => r.params);
  return { sql, params };
}

// Bare condition (no WHERE keyword) — empty string when the tree filters nothing.
function buildConditionFromTree(tree: FilterTree): SqlFragment {
  if (tree.children.length === 0) return { sql: '', params: [] };
  const { sql, params } = nodeSql(tree);
  if (sql === '1=1') return { sql: '', params: [] };
  return { sql, params };
}

function buildWhereFromTree(tree: FilterTree): WhereResult {
  const { sql, params } = buildConditionFromTree(tree);
  return { where: sql ? `WHERE ${sql}` : '', params };
}

async function attachMetadata(
  adapter: SourceDataAdapter,
  entities: Entity[],
  keys?: string[]
): Promise<EntityWithMetadata[]> {
  if (entities.length === 0) return [];

  const { sql: inSql, params: inParams } = adapter.inList(
    'entity_id',
    entities.map(e => e.id)
  );
  // Callers that only read a handful of known metadata keys (e.g. chart
  // building, which knows exactly which fields a viz config references) can
  // scope this query instead of pulling every key for every matched entity —
  // the dominant cost of this query at real metadata cardinality.
  const keyFilter =
    keys && keys.length > 0 ? ` AND key IN (${keys.map(() => '?').join(', ')})` : '';
  const keyParams: SqlParam[] = keys && keys.length > 0 ? keys : [];
  const metaRows = await adapter.query(
    `SELECT * FROM entity_metadata WHERE ${inSql}${keyFilter} ORDER BY key`,
    [...inParams, ...keyParams]
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

type MetaValueRow = {
  key: string;
  value_type: string;
  value: string;
  entity_type: string;
};

// Rows must arrive ordered by (entity_type, key): result order follows first
// appearance, and the first row of each group decides its value_type.
function buildMetaFilters(rows: MetaValueRow[], distinctLimit: number): AvailableFilter[] {
  const byKeyAndType = new Map<
    string,
    { value_type: string; values: Set<string>; entity_type: string }
  >();
  for (const row of rows) {
    const mapKey = `${row.entity_type}::${row.key}`;
    if (!byKeyAndType.has(mapKey)) {
      byKeyAndType.set(mapKey, {
        value_type: row.value_type,
        values: new Set(),
        entity_type: row.entity_type,
      });
    }
    byKeyAndType.get(mapKey)!.values.add(row.value);
  }

  return Array.from(byKeyAndType.entries()).map(([mapKey, { value_type, values, entity_type }]) => {
    const key = mapKey.split('::')[1];
    const parsed = MetadataValueTypeSchema.safeParse(value_type);
    const vt = parsed.success ? parsed.data : ('string' as const);
    const filter: AvailableFilter = {
      key,
      value_type: vt,
      entityType: entity_type,
    };
    if (vt === 'string' && values.size <= distinctLimit) {
      filter.distinctValues = Array.from(values).sort();
    }
    return filter;
  });
}

async function buildEntityFieldFilters(
  adapter: SourceDataAdapter,
  populationCondition: string,
  params: SqlParam[]
): Promise<AvailableFilter[]> {
  const filters: AvailableFilter[] = [];
  for (const [key, config] of Object.entries(ENTITY_FIELDS)) {
    const filter: AvailableFilter = { key, value_type: config.value_type, entityType: '' };
    if (config.withDistinctValues) {
      const cond = populationCondition ? `${populationCondition} AND ` : '';
      const rows = await adapter.query<{ val: string }>(
        `SELECT DISTINCT e.${config.column} AS val FROM entities e WHERE ${cond}e.${config.column} != '' ORDER BY e.${config.column}`,
        params
      );
      filter.distinctValues = rows.map(r => r.val);
    }
    filters.push(filter);
  }
  return filters;
}

// getAvailableFilters/listMetadataKeys are read-only aggregates over a source
// database this app never writes to at runtime (see upsert's doc comment) —
// staleness is bounded by CACHE_TTL_MS, not by any write path invalidating it.
// If a feature ever lets users edit source entities/metadata in-app, this
// needs to become invalidate-on-write instead.
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 300;

// Keyed by adapter identity (not a module-level singleton) so each adapter —
// each test's fresh in-memory database, or a real long-lived process adapter
// — gets its own isolated cache. A shared cache keyed only on tree+options
// would leak results across unrelated adapters/tests.
const cachesByAdapter = new WeakMap<
  SourceDataAdapter,
  { availableFilters: TtlCache<AvailableFilter[]>; metadataKeys: TtlCache<string[]> }
>();

function getCaches(adapter: SourceDataAdapter) {
  let caches = cachesByAdapter.get(adapter);
  if (!caches) {
    caches = {
      availableFilters: createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES }),
      metadataKeys: createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES }),
    };
    cachesByAdapter.set(adapter, caches);
  }
  return caches;
}

async function fetchMetadataKeys(
  adapter: SourceDataAdapter,
  entityType: string
): Promise<string[]> {
  const rows = await adapter.query<{ key: string }>(
    `SELECT DISTINCT em.key AS key
     FROM entity_metadata em
     JOIN entities e ON e.id = em.entity_id
     WHERE e.type = ?
     ORDER BY em.key`,
    [entityType]
  );
  return rows.map(r => r.key);
}

async function fetchAvailableFilters(
  adapter: SourceDataAdapter,
  tree: FilterTree,
  opts: { allDistinctValues?: boolean }
): Promise<AvailableFilter[]> {
  const { sql: condition, params } = buildConditionFromTree(tree);
  const where = condition ? `WHERE ${condition}` : '';

  const present = await adapter.query(`SELECT e.id FROM entities e ${where} LIMIT 1`, params);
  if (present.length === 0) return [];

  const distinctLimit = opts.allDistinctValues ? Infinity : 20;
  // Fetch one value past the cap so buildMetaFilters can still tell
  // over-the-cap keys apart and withhold their distinctValues.
  const rankCap = Number.isFinite(distinctLimit) ? 'WHERE value_rank <= ?' : '';
  const rankParams: SqlParam[] = Number.isFinite(distinctLimit) ? [distinctLimit + 1] : [];

  // Split by value_type: only string-typed values ever surface as
  // distinctValues downstream (buildMetaFilters), so number/date keys never
  // need their (often near-unique) values grouped/ranked — just registered as
  // filterable keys. Grouping the full population by (type, key, value) for
  // those columns was the dominant cost of this query; grouping by (type,
  // key) only for them is dramatically cheaper. Tie-break on value_type in
  // the final ORDER BY keeps the reported value_type deterministic for the
  // (rare) key whose value_type is inconsistent across entities.
  const rows = await adapter.query<MetaValueRow>(
    `WITH pop AS (SELECT e.id, e.type FROM entities e ${where}),
     str_vals AS (
       SELECT pop.type AS entity_type, em.key AS key, em.value AS value, em.value_type AS value_type
       FROM entity_metadata em
       JOIN pop ON pop.id = em.entity_id
       WHERE em.value IS NOT NULL AND em.value_type = 'string'
       GROUP BY pop.type, em.key, em.value
     ),
     str_ranked AS (
       SELECT entity_type, key, value, value_type,
              ROW_NUMBER() OVER (PARTITION BY entity_type, key ORDER BY value) AS value_rank
       FROM str_vals
     ),
     other_keys AS (
       SELECT DISTINCT pop.type AS entity_type, em.key AS key, em.value_type AS value_type
       FROM entity_metadata em
       JOIN pop ON pop.id = em.entity_id
       WHERE em.value IS NOT NULL AND em.value_type != 'string'
     )
     SELECT entity_type, key, value, value_type FROM str_ranked ${rankCap}
     UNION ALL
     SELECT entity_type, key, NULL AS value, value_type FROM other_keys
     ORDER BY entity_type, key, value, value_type`,
    [...params, ...rankParams]
  );

  const entityFieldFilters = await buildEntityFieldFilters(adapter, condition, params);
  return [...entityFieldFilters, ...buildMetaFilters(rows, distinctLimit)];
}

export type PageOptions = { limit: number; offset: number };

export type PagedEntities = {
  pageEntities: EntityWithMetadata[];
  total: number;
};

export type EntityRepository = ReturnType<typeof createEntityRepository>;

export function createEntityRepository(adapter: SourceDataAdapter) {
  return {
    // `opts.keys` scopes the metadata fetched per entity to a known subset
    // (e.g. the fields a chart's config actually reads) instead of every key —
    // omit it when the caller needs the full metadata set (e.g. rendering a
    // metadata table).
    async list(tree: FilterTree, opts: { keys?: string[] } = {}): Promise<EntityWithMetadata[]> {
      const { where, params } = buildWhereFromTree(tree);
      const rows = await adapter.query(
        `SELECT * FROM entities e ${where} ORDER BY e.id DESC`,
        params
      );
      const entities = rows.map(row => EntitySchema.parse(row));
      return attachMetadata(adapter, entities, opts.keys);
    },

    async listEntityTypes(): Promise<string[]> {
      const rows = await adapter.query<{ type: string }>(
        `SELECT DISTINCT type FROM entities WHERE type != '' ORDER BY type`
      );
      return rows.map(r => r.type);
    },

    // Every metadata key that exists for an entity type, regardless of whether
    // the current filter population happens to have non-null values for it.
    // This drives the entity-list columns: a key present on the type stays a
    // column even when every row in view is null (e.g. filtering to `key: null`).
    // Scoped to the type only — unaffected by the rest of the filter tree.
    async listMetadataKeys(entityType: string): Promise<string[]> {
      return getCaches(adapter).metadataKeys.getOrCreate(entityType, () =>
        fetchMetadataKeys(adapter, entityType)
      );
    },

    // Paginated variant: returns one page of entities (with metadata) plus a
    // total count. Pagination and count happen in SQL — no id list crosses the
    // wire.
    async listPaged(tree: FilterTree, page: PageOptions): Promise<PagedEntities> {
      const { where, params } = buildWhereFromTree(tree);

      const countRows = await adapter.query<{ total: number | string }>(
        `SELECT COUNT(*) AS total FROM entities e ${where}`,
        params
      );
      // node-pg returns COUNT(*) (int8) as a string.
      const total = Number(countRows[0].total);
      const pageRows = await adapter.query(
        `SELECT * FROM entities e ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset]
      );
      const pageEntities = await attachMetadata(
        adapter,
        pageRows.map(r => EntitySchema.parse(r))
      );
      return { pageEntities, total };
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

    // Available filters for the population defined by a filter tree.
    // Aggregation runs entirely in SQL — no entity ids leave the database.
    // `allDistinctValues: true` lifts the per-field 20-value cap — only the
    // filter editor's "values with this leaf disabled" fetch should pass it,
    // since other call sites embed the values in initial page HTML.
    //
    // Cached per (tree, allDistinctValues): this recomputes on every /entities
    // request (initial load, pagination, filter tweaks) otherwise, and it's the
    // most expensive query on that path by a wide margin at real data volumes.
    async getAvailableFilters(
      tree: FilterTree,
      opts: { allDistinctValues?: boolean } = {}
    ): Promise<AvailableFilter[]> {
      const cacheKey = `${JSON.stringify(canonicalizeTree(tree))}::${opts.allDistinctValues ? 1 : 0}`;
      return getCaches(adapter).availableFilters.getOrCreate(cacheKey, () =>
        fetchAvailableFilters(adapter, tree, opts)
      );
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
