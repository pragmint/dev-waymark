// Parser for the filter bar's `filter-config` embed. The preset id ends up in
// URLs and the entity type in the filter tree sent to the server, so each field
// is checked here rather than cast.
import { asPositiveInteger, asRecord } from './jsonEmbed';

export type FilterConfig = {
  selectedPresetId: number | null;
  selectedEntityType: string | null;
  isDraft: boolean;
};

export function parseFilterConfig(raw: unknown): FilterConfig {
  const r = asRecord(raw);
  return {
    selectedPresetId: asPositiveInteger(r.selectedPresetId),
    selectedEntityType: typeof r.selectedEntityType === 'string' ? r.selectedEntityType : null,
    isDraft: r.isDraft === true,
  };
}
