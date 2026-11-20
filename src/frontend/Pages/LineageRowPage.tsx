import type { FC } from 'hono/jsx';
import type { LineageRow, ParentGroup } from '../../schemas/lineage';
import {
  CONTRACT_COLUMNS,
  FIELDS_COLUMN,
  SOURCES_COLUMN,
  lineagePath,
  withQuery,
} from '../../domain/lineage';
import { refText } from '../../domain/columnLineage';
import type { FieldTrace } from '../../domain/columnLineage';
import { LineageFieldNote } from '../components/LineageFieldNote';
import { Layout } from '../components/Layout';
import { LineageParentGroup } from '../components/LineageParentGroup';

// dlt stores nested API objects (Jira's `fields`, a PR's `head`) as JSON text.
// Parse them so the raw record reads as one JSON document.
function expandJsonText(values: Record<string, unknown>): Record<string, unknown> {
  const expanded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    expanded[key] = value;
    if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) continue;
    try {
      expanded[key] = JSON.parse(value);
    } catch {
      // Not JSON after all: keep the text.
    }
  }
  return expanded;
}

// With a column map, each field name links to that field's lineage. `_sources` and `_fields`
// are what the links follow, so they aren't shown as fields themselves.
const RowFields: FC<{ row: LineageRow; fieldHref?: (field: string) => string; field?: string }> = ({
  row,
  fieldHref,
  field,
}) => (
  <dl class="entity-fields lineage-fields">
    {Object.entries(row.values)
      .filter(([key]) => key !== SOURCES_COLUMN && key !== FIELDS_COLUMN)
      .map(([key, value]) => (
        <>
          <dt class={key === field ? 'lineage-field--active' : undefined}>
            {fieldHref && !CONTRACT_COLUMNS.includes(key) ? (
              <a class="lineage-field-link" href={fieldHref(key)}>
                {key}
              </a>
            ) : (
              key
            )}
          </dt>
          <dd class={key === field ? 'lineage-field--active' : undefined}>
            {value === null || value === undefined ? (
              '—'
            ) : typeof value === 'object' ? (
              <code>{JSON.stringify(value)}</code>
            ) : (
              String(value)
            )}
          </dd>
        </>
      ))}
  </dl>
);

const FieldNote: FC<{ table: string; rowId: string; field: string; trace: FieldTrace | null }> = ({
  table,
  rowId,
  field,
  trace,
}) => {
  const self = lineagePath(table, rowId);
  if (!trace) {
    return (
      <LineageFieldNote
        field={field}
        heading="no column lineage"
        columns={[]}
        empty="This table's column map doesn't declare this field, so every source is shown."
      >
        <a href={self}>Show all fields</a>
      </LineageFieldNote>
    );
  }
  return (
    <LineageFieldNote
      field={field}
      heading="computed from"
      columns={trace.direct.map(refText)}
      empty="A constant: it reads no input column."
    >
      {trace.direct.length > 0 ? (
        <a class="lineage-action" href={withQuery(lineagePath(table, rowId, '/raw'), { field })}>
          Expand this field to raw
        </a>
      ) : null}
      <a href={self}>Show all fields</a>
    </LineageFieldNote>
  );
};

export const LineageRowPage: FC<{
  table: string;
  row: LineageRow;
  isRaw: boolean;
  parents: ParentGroup[];
  entityHref?: string;
  hasColumnMap?: boolean;
  field?: string;
  trace?: FieldTrace | null;
}> = ({ table, row, isRaw, parents, entityHref, hasColumnMap, field, trace = null }) => (
  <Layout title={`${table} ${row.rowId}`}>
    <div class="page-header">
      <a href="/entities" class="back-link">
        ← Entities
      </a>
      <h1>
        <span class="lineage-table-name">{table}</span> <code>{row.rowId}</code>
      </h1>
      {isRaw ? <span class="badge">raw record</span> : null}
      <div class="page-header-actions">
        {entityHref ? (
          <a class="lineage-action" href={entityHref}>
            Open entity
          </a>
        ) : null}
        {isRaw ? null : (
          <a class="lineage-action" href={lineagePath(table, row.rowId, '/raw')}>
            Expand to raw
          </a>
        )}
      </div>
    </div>

    {isRaw ? (
      <section class="lineage-raw">
        <p class="lineage-note">The root of lineage: this record is exactly as it was extracted.</p>
        <pre class="lineage-json" data-raw-record>
          {JSON.stringify(expandJsonText(row.values), null, 2)}
        </pre>
      </section>
    ) : (
      <>
        <section class="entity-detail">
          <RowFields
            row={row}
            field={field}
            fieldHref={
              hasColumnMap
                ? key => withQuery(lineagePath(table, row.rowId), { field: key })
                : undefined
            }
          />
        </section>
        {field ? <FieldNote table={table} rowId={row.rowId} field={field} trace={trace} /> : null}
        <section class="lineage-parents">
          <h2>{field && trace ? `${field} is built from` : 'Built from'}</h2>
          {parents.length === 0 ? <p class="empty">This row lists no sources.</p> : null}
          {parents.map(group => (
            <LineageParentGroup
              group={group}
              moreHref={withQuery(lineagePath(table, row.rowId), { field, limit: 'all' })}
            />
          ))}
        </section>
      </>
    )}
  </Layout>
);
