/**
 * Formats a date string from dd.mm.yyyy format to a readable format
 * Example: "23.1.2026" -> "January 23, 2026"
 */
export function formatDateString(dateString: string): string {
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
