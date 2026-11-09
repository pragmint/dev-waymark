import type { FC } from 'hono/jsx';
import type { ParentGroup } from '../../schemas/lineage';
import { LineageRowsTable } from './LineageRowsTable';

// One source table's rows behind a lineage row, with a link to show past the limit.
export const LineageParentGroup: FC<{ group: ParentGroup; moreHref: string }> = ({
  group,
  moreHref,
}) => (
  <section class="lineage-group" data-lineage-group={group.table}>
    <h3>
      <span class="lineage-table-name">{group.table}</span>
      {group.isRaw ? <span class="badge">raw</span> : null}
      <span class="count">
        {group.total.toLocaleString()} {group.total === 1 ? 'row' : 'rows'}
      </span>
    </h3>
    {!group.available ? (
      <p class="empty">This run has no {group.table} table to show these rows from.</p>
    ) : (
      <>
        <LineageRowsTable table={group.table} rows={group.rows} highlight={group.highlight} />
        {group.rows.length < group.total ? (
          <p class="lineage-more">
            Showing {group.rows.length} of {group.total.toLocaleString()}.{' '}
            <a href={moreHref}>Show all</a>
          </p>
        ) : null}
      </>
    )}
  </section>
);
