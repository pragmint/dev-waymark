import type { FC } from 'hono/jsx';
import type { Hop, ParentGroup } from '../../schemas/lineage';
import { hopSize, lineagePath } from '../../domain/lineage';
import { Layout } from '../components/Layout';
import { LineageParentGroup } from '../components/LineageParentGroup';

export const LineageRawPage: FC<{
  table: string;
  rowId: string;
  hops: Hop[];
  leaves: ParentGroup[];
}> = ({ table, rowId, hops, leaves }) => (
  <Layout title={`Raw records behind ${table} ${rowId}`}>
    <div class="page-header">
      <a href={lineagePath(table, rowId)} class="back-link">
        ← {table} {rowId}
      </a>
      <h1>Raw records</h1>
      <span class="count">{leaves.reduce((sum, group) => sum + group.total, 0)} in all</span>
    </div>

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
          moreHref={`${lineagePath(table, rowId, '/raw')}?limit=all`}
        />
      ))}
    </section>
  </Layout>
);
