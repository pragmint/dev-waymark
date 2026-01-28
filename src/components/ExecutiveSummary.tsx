import type { FC } from 'hono/jsx';
import { formatDateString } from '../core/utils/dateFormatter';

export interface ExecutiveSummaryProps {
  htmlContent: string;
  currentDate: string;
  availableDates: string[];
}

export const ExecutiveSummary: FC<ExecutiveSummaryProps> = ({
  htmlContent,
  currentDate,
  availableDates,
}) => {
  return (
    <div class="executive-summary">
      <div class="executive-summary-header">
        <h2>Executive Summary</h2>
        {availableDates.length > 1 && (
          <div class="summary-selector">
            <select id="summary-date-select" data-current-date={currentDate}>
              {availableDates.map((date, index) => (
                <option value={date} selected={date === currentDate}>
                  {formatDateString(date)}
                  {index === 0 ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div class="executive-summary-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
    </div>
  );
};
