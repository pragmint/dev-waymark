import type { SourceDataAdapter, SqlParam } from './source/adapter';
import { EntitySchema, MetadataSchema, MetadataValueTypeSchema } from '../schemas/entity';
import type {
  Entity,
  Metadata,
  MetadataValueType,
  EntityWithMetadata,
  AvailableFilter,
} from '../schemas/entity';
import { isGroup, isLeaf, treeHasRegex } from '../schemas/filterTree';
import type { FilterLeaf, FilterNode, FilterTree } from '../schemas/filterTree';
import { evaluateFilterTree } from '../domain/filterTreeEval';

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

function leafSql(leaf: FilterLeaf): SqlFragment {
  // Regex leaves are evaluated in JS after the query — SQL returns a superset.
  if (leaf.op === 're') return { sql: '1=1', params: [] };
  const entityField = ENTITY_FIELDS[leaf.key];
  if (leaf.op === 'eq') return eqSql(leaf, entityField);
  const value = Array.isArray(leaf.value) ? (leaf.value[0] ?? '') : leaf.value;
  if (leaf.op === 'contains') return containsSql(leaf, value, entityField);
  if (leaf.op === 'gte') return rangeSql(leaf, value, entityField, '>=');
  if (leaf.op === 'lte') return rangeSql(leaf, value, entityField, '<=');
  return { sql: '1=1', params: [] };
}

function nodeSql(node: FilterNode): SqlFragment {
  if (isLeaf(node)) return leafSql(node);
  if (!isGroup(node)) return { sql: '1=1', params: [] };
  if (node.children.length === 0) return { sql: '1=1', params: [] };

  if (node.op === 'NOT') {
    // NOT(1=1) would collapse to 1=0 and exclude rows the JS post-filter needs
    // to inspect — fall back to a superset and let evaluateFilterTree narrow.
    if (treeHasRegex(node)) return { sql: '1=1', params: [] };
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

function buildWhereFromTree(tree: FilterTree): WhereResult {
  if (tree.children.length === 0) return { where: '', params: [] };
  const { sql, params } = nodeSql(tree);
  if (sql === '1=1') return { where: '', params: [] };
  return { where: `WHERE ${sql}`, params };
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

export type PageOptions = { limit: number; offset: number };

export type PagedEntities = {
  pageEntities: EntityWithMetadata[];
  allIds: number[];
  total: number;
};

export type EntityRepository = ReturnType<typeof createEntityRepository>;

export function createEntityRepository(adapter: SourceDataAdapter) {
  return {
    async list(tree: FilterTree): Promise<EntityWithMetadata[]> {
      const { where, params } = buildWhereFromTree(tree);
      const rows = await adapter.query(
        `SELECT * FROM entities e ${where} ORDER BY e.id DESC`,
        params
      );
      const entities = rows.map(row => EntitySchema.parse(row));
      const withMeta = await attachMetadata(adapter, entities);
      if (!treeHasRegex(tree)) return withMeta;
      return withMeta.filter(e => evaluateFilterTree(tree, e));
    },

    // Paginated variant: returns one page of entities (with metadata) plus the
    // full set of matching IDs (so getAvailableFilters can narrow against the
    // entire filtered population, not just the current page) and a total count.
    async listPaged(tree: FilterTree, page: PageOptions): Promise<PagedEntities> {
      const { where, params } = buildWhereFromTree(tree);
      const needsPostFilter = treeHasRegex(tree);

      // When the tree has regex leaves we returned a SQL superset; materialise the full
      // filtered set in JS before slicing so getAvailableFilters narrows against the real
      // population. The win over rendering 10k+ rows still applies.
      if (needsPostFilter) {
        const rows = await adapter.query(
          `SELECT * FROM entities e ${where} ORDER BY e.id DESC`,
          params
        );
        const entities = rows.map(row => EntitySchema.parse(row));
        const withMeta = await attachMetadata(adapter, entities);
        const filtered = withMeta.filter(e => evaluateFilterTree(tree, e));
        return {
          pageEntities: filtered.slice(page.offset, page.offset + page.limit),
          allIds: filtered.map(e => e.id),
          total: filtered.length,
        };
      }

      const idRows = await adapter.query<{ id: number }>(
        `SELECT e.id FROM entities e ${where} ORDER BY e.id DESC`,
        params
      );
      const allIds = idRows.map(r => r.id);
      const pageIds = allIds.slice(page.offset, page.offset + page.limit);
      if (pageIds.length === 0) {
        return { pageEntities: [], allIds, total: allIds.length };
      }
      const placeholders = pageIds.map(() => '?').join(',');
      const pageRows = await adapter.query(
        `SELECT * FROM entities WHERE id IN (${placeholders}) ORDER BY id DESC`,
        pageIds
      );
      const pageEntities = await attachMetadata(
        adapter,
        pageRows.map(r => EntitySchema.parse(r))
      );
      return { pageEntities, allIds, total: allIds.length };
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
    // `allDistinctValues: true` lifts the per-field 20-value cap on distinctValues
    // — only the filter editor's "values with this leaf disabled" fetch should pass
    // it, since other call sites embed the values in initial page HTML.
    async getAvailableFilters(
      entityIds: number[],
      opts: { allDistinctValues?: boolean } = {}
    ): Promise<AvailableFilter[]> {
      if (entityIds.length === 0) return [];
      const distinctLimit = opts.allDistinctValues ? Infinity : 20;

      const placeholders = entityIds.map(() => '?').join(', ');
      const rows = await adapter.query<{
        key: string;
        value_type: string;
        value: string;
        entity_type: string;
      }>(
        `SELECT em.key, em.value_type, em.value, e.type AS entity_type
         FROM entity_metadata em
         JOIN entities e ON e.id = em.entity_id
         WHERE em.entity_id IN (${placeholders})
         AND em.value IS NOT NULL
         ORDER BY e.type, em.key, em.value`,
        entityIds
      );

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

      const metaFilters = Array.from(byKeyAndType.entries()).map(
        ([mapKey, { value_type, values, entity_type }]) => {
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
        }
      );
      const entityFieldFilters: AvailableFilter[] = [];
      for (const [key, config] of Object.entries(ENTITY_FIELDS)) {
        const filter: AvailableFilter = { key, value_type: config.value_type, entityType: '' };
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
