import type { FC } from 'hono/jsx';
import type { Preset } from '../../schemas/preset';
import { Layout } from '../components/Layout';

type PresetWithUrl = Preset & { url: string };

type PresetsPageProps = {
  presets: PresetWithUrl[];
};

export const PresetsPage: FC<PresetsPageProps> = ({ presets }) => (
  <Layout title="Saved Presets">
    <div class="page-header">
      <h1>Saved Presets</h1>
      <span class="count">
        {presets.length} preset{presets.length !== 1 ? 's' : ''}
      </span>
    </div>

    {presets.length === 0 ? (
      <p class="empty">
        No saved presets yet. Apply filters on the <a href="/entities">Entities</a> page and save
        them.
      </p>
    ) : (
      <table class="entity-table">
        <thead>
          <tr>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {presets.map(d => (
            <tr>
              <td>
                <a href={d.url}>{d.name}</a>
              </td>
              <td style="text-align:right">
                <form method="post" action={`/presets/${d.id}/delete`}>
                  <button type="submit" class="btn-text">
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Layout>
);
