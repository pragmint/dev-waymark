import type { FC } from 'hono/jsx';
import type { LineageRow } from '../../schemas/lineage';
import { PREVIEW_CHARS, idColumnFor, lineagePath } from '../../domain/lineage';

// Columns a listing leaves out: lineage plumbing, shown as links instead.
const HIDDEN_COLUMNS = new Set(['_sources', '_row_id', '_dlt_id', '_dlt_load_id']);
const MAX_COLUMNS = 8;

/** A cell's text: JSON for nested values, cut at the preview length the query fetched. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

// Prose wraps; everything short stays on one line so ids and numbers don't split.
const WRAP_AT_CHARS = 24;

function cellClass(value: unknown): string {
  return displayValue(value).length > WRAP_AT_CHARS
    ? 'lineage-cell lineage-cell--text'
    : 'lineage-cell';
}

function visibleColumns(rows: LineageRow[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row.values)) {
      if (!HIDDEN_COLUMNS.has(key) && !columns.includes(key)) columns.push(key);
    }
  }
  return columns.slice(0, MAX_COLUMNS);
}

export const LineageRowsTable: FC<{ table: string; rows: LineageRow[] }> = ({ table, rows }) => {
  const columns = visibleColumns(rows);
  return (
    <div class="lineage-table-scroll">
      <table class="entity-table lineage-table" data-lineage-table={table}>
        <thead>
          <tr>
            <th>{idColumnFor(table)}</th>
            {columns.map(column => (
              <th>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr>
              <td>
                <a class="entity-link" href={lineagePath(table, row.rowId)}>
                  {row.rowId}
                </a>
              </td>
              {columns.map(column => (
                <td class={cellClass(row.values[column])}>{displayValue(row.values[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
