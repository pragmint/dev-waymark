import type { FC } from 'hono/jsx';
import type { LineageRow, ParentGroup } from '../../schemas/lineage';
import { lineagePath } from '../../domain/lineage';
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

const RowFields: FC<{ row: LineageRow }> = ({ row }) => (
  <dl class="entity-fields lineage-fields">
    {Object.entries(row.values)
      .filter(([key]) => key !== '_sources')
      .map(([key, value]) => (
        <>
          <dt>{key}</dt>
          <dd>
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

export const LineageRowPage: FC<{
  table: string;
  row: LineageRow;
  isRaw: boolean;
  parents: ParentGroup[];
  entityHref?: string;
}> = ({ table, row, isRaw, parents, entityHref }) => (
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
          <RowFields row={row} />
        </section>
        <section class="lineage-parents">
          <h2>Built from</h2>
          {parents.length === 0 ? <p class="empty">This row lists no sources.</p> : null}
          {parents.map(group => (
            <LineageParentGroup
              group={group}
              moreHref={`${lineagePath(table, row.rowId)}?limit=all`}
            />
          ))}
        </section>
      </>
    )}
  </Layout>
);
