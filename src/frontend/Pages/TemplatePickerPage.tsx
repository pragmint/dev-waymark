import type { FC } from 'hono/jsx';
import type { Preset } from '../../schemas/preset';
import { TEMPLATES } from '../../schemas/visualizationTemplate';
import { templateCardState } from '../../domain/templateCardState';
import { Layout } from '../components/Layout';

type Props = {
  presets: Preset[];
  selectedPresetId: number | null;
};

export const TemplatePickerPage: FC<Props> = ({ presets, selectedPresetId }) => {
  if (presets.length === 0) {
    return (
      <Layout title="New Visualization">
        <div class="page-header">
          <h1>New Visualization</h1>
        </div>
        <p class="empty">
          No presets yet. <a href="/entities">Create one</a> from the Entities page.
        </p>
      </Layout>
    );
  }

  const presetIdStr = selectedPresetId == null ? '' : String(selectedPresetId);
  const hasPreset = presetIdStr !== '';

  return (
    <Layout title="New Visualization" extraScripts={['/chartBuilder.js']}>
      <div class="page-header">
        <h1>New Visualization</h1>
      </div>

      <div style="margin-bottom:24px">
        <label
          class="filter-widget-label"
          for="preset-picker"
          style="display:block;margin-bottom:6px"
        >
          Preset
        </label>
        <select id="preset-picker" class="filter-select" style="min-width:200px">
          <option value="" selected={!hasPreset}>
            — Select a preset —
          </option>
          {presets.map(d => (
            <option key={d.id} value={d.id} selected={d.id === selectedPresetId}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div
        style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px"
        id="template-grid"
        aria-disabled={hasPreset ? 'false' : 'true'}
      >
        {TEMPLATES.map(t => {
          const state = templateCardState(t.id, presetIdStr);
          const cardClass = state.disabled
            ? 'template-card template-card--disabled'
            : 'template-card';
          return (
            <a
              key={t.id}
              href={state.href}
              class={cardClass}
              data-template-id={t.id}
              aria-disabled={state.disabled ? 'true' : 'false'}
            >
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span style="font-weight:600;font-size:14px">{t.name}</span>
                <span class="badge">{t.chartType}</span>
              </div>
              <p style="margin:0;font-size:13px;color:var(--color-muted);line-height:1.4">
                {t.description}
              </p>
            </a>
          );
        })}
      </div>
    </Layout>
  );
};
