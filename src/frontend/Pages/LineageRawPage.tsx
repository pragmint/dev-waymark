import type { FC } from 'hono/jsx';
import type { Hop, ParentGroup } from '../../schemas/lineage';
import { hopSize, isRawTable, lineagePath, withQuery } from '../../domain/lineage';
import type { FieldTrace } from '../../domain/columnLineage';
import { LineageFieldNote } from '../components/LineageFieldNote';
import { Layout } from '../components/Layout';
import { LineageParentGroup } from '../components/LineageParentGroup';

export const LineageRawPage: FC<{
  table: string;
  rowId: string;
  hops: Hop[];
  leaves: ParentGroup[];
  field?: string;
  trace?: FieldTrace | null;
  /** The column labels the field reads, by table. */
  columns?: Record<string, string[]>;
}> = ({ table, rowId, hops, leaves, field, trace = null, columns = {} }) => (
  <Layout title={`Raw records behind ${table} ${rowId}`}>
    <div class="page-header">
      <a href={withQuery(lineagePath(table, rowId), { field })} class="back-link">
        ← {table} {rowId}
      </a>
      <h1>Raw records</h1>
      <span class="count">{leaves.reduce((sum, group) => sum + group.total, 0)} in all</span>
    </div>

    {field ? (
      <LineageFieldNote
        field={field}
        heading={trace ? 'raw fields it comes from' : 'no column lineage'}
        columns={Object.entries(trace ? columns : {})
          .filter(([columnTable]) => isRawTable(columnTable))
          .flatMap(([columnTable, labels]) => labels.map(label => `${columnTable}.${label}`))}
        empty={
          trace
            ? 'It reads no raw field.'
            : "This table's column map doesn't declare this field, so every raw record is shown."
        }
      >
        <a href={lineagePath(table, rowId, '/raw')}>Show raw records for every field</a>
      </LineageFieldNote>
    ) : null}

    <section class="lineage-hops">
      <h2>Path</h2>
      <ol class="lineage-hop-list">
        {hops.map((hop, depth) => (
          <li>
            <span class="lineage-hop-depth">Hop {depth}</span>
            {Object.entries(hop).map(([hopTable, ids]) => (
              <span class="lineage-hop-table">
                {hopTable} <span class="count">{ids.length.toLocaleString()}</span>
              </span>
            ))}
            <span class="count">
              ({hopSize(hop).toLocaleString()} {hopSize(hop) === 1 ? 'row' : 'rows'})
            </span>
          </li>
        ))}
      </ol>
    </section>

    <section class="lineage-parents">
      {leaves.length === 0 ? <p class="empty">No raw records reached.</p> : null}
      {leaves.map(group => (
        <LineageParentGroup
          group={group}
          moreHref={withQuery(lineagePath(table, rowId, '/raw'), { field, limit: 'all' })}
        />
      ))}
    </section>
  </Layout>
);
