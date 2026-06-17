export type TemplateCardState = {
  href: string;
  disabled: boolean;
};

export function templateCardState(templateId: string, presetId: string): TemplateCardState {
  if (presetId === '') return { href: '#', disabled: true };
  return {
    href: `/visualizations/new/${templateId}?preset_id=${presetId}`,
    disabled: false,
  };
}
