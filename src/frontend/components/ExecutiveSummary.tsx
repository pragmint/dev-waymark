import type { FC } from 'hono/jsx';

function formatDateString(dateString: string): string {
  const [day, month, year] = dateString.split('.');
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

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
      <div
        class="executive-summary-content markdown-content"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
};
