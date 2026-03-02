import type { FC } from 'hono/jsx';

export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipSelectorProps {
  queryKey: string;
  label: string;
  options: ChipOption[];
}

/**
 * ChipSelector - A URL-driven multi-select chip component
 *
 * Each instance manages its own state via URL query parameters using client-side JavaScript.
 * Multiple instances can coexist on the same page with different queryKeys.
 *
 * @param queryKey - Unique identifier for this chip selector instance (used as URL param name)
 * @param label - Display label for the chip selector group
 * @param options - Array of chip options to display
 */
export const ChipSelector: FC<ChipSelectorProps> = ({ queryKey, label, options }) => {
  return (
    <div class="chip-selector" data-query-key={queryKey}>
      <div class="chip-selector-header">
        <span class="chip-selector-label">{label}</span>
        <button type="button" class="chip-clear-btn" data-query-key={queryKey}>
          Clear
        </button>
      </div>
      <div class="chip-selector-wrapper">
        <div class="chip-selector-options">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              class="chip"
              data-query-key={queryKey}
              data-value={option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
