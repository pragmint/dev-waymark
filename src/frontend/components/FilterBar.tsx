import type { FC } from 'hono/jsx';
import type { EntityFilters } from '../../schemas/entity';

type FilterBarProps = {
  filters: EntityFilters;
  sources: string[];
  types: string[];
};

export const FilterBar: FC<FilterBarProps> = ({ filters, sources, types }) => (
  <form action="/entities" method="get" class="filter-bar" data-filter-form="true">
    <select name="source" class="filter-select">
      <option value="">All sources</option>
      {sources.map(s => (
        <option value={s} selected={filters.source === s}>
          {s}
        </option>
      ))}
    </select>

    <select name="type" class="filter-select">
      <option value="">All types</option>
      {types.map(t => (
        <option value={t} selected={filters.type === t}>
          {t}
        </option>
      ))}
    </select>

    <input
      type="date"
      name="from"
      value={filters.from ?? ''}
      placeholder="From"
      class="filter-input"
    />
    <input type="date" name="to" value={filters.to ?? ''} placeholder="To" class="filter-input" />

    <button type="submit" class="filter-btn">
      Filter
    </button>

    {(filters.source || filters.type || filters.from || filters.to) && (
      <a href="/entities" class="filter-clear">
        Clear
      </a>
    )}
  </form>
);
