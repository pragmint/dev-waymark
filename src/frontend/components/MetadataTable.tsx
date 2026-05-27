import type { FC } from 'hono/jsx';
import type { Metadata } from '../../schemas/entity';

export const MetadataTable: FC<{ metadata: Metadata[] }> = ({ metadata }) => {
  if (metadata.length === 0) {
    return <p class="empty">No metadata.</p>;
  }

  return (
    <table class="metadata-table">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Type</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {metadata.map(m => (
          <tr>
            <td class="meta-key">{m.key}</td>
            <td class="meta-value">{m.value ?? '—'}</td>
            <td class="meta-type">{m.value_type}</td>
            <td class="meta-timestamps">
              <span
                class="meta-timestamps-trigger"
                data-tip={`Created: ${m.created_at}\nUpdated: ${m.updated_at}`}
              >
                ⏱
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
