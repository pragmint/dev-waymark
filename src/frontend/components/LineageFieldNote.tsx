import type { Child, FC } from 'hono/jsx';

// The field a lineage page is narrowed to, and the columns it is computed from.
export const LineageFieldNote: FC<{
  field: string;
  heading: string;
  columns: string[];
  empty: string;
  children?: Child;
}> = ({ field, heading, columns, empty, children }) => (
  <section class="lineage-field" data-lineage-field={field}>
    <p class="lineage-field-heading">
      Field <code>{field}</code> · {heading}
    </p>
    {columns.length === 0 ? (
      <p class="lineage-note">{empty}</p>
    ) : (
      <ul class="lineage-field-refs">
        {columns.map(column => (
          <li>
            <code>{column}</code>
          </li>
        ))}
      </ul>
    )}
    <div class="lineage-field-actions">{children}</div>
  </section>
);
