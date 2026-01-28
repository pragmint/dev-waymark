/**
 * Parses a date string in d.m.yyyy or dd.mm.yyyy format to a Date object
 * Example: "27.1.2026" -> Date object
 */
export function parseDate(dateString: string): Date {
  const [day, month, year] = dateString.split('.');
  // Month is 0-indexed in JavaScript Date
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Formats a date string from dd.mm.yyyy format to a readable format
 * Example: "23.1.2026" -> "January 23, 2026"
 */
export function formatDateString(dateString: string): string {
  const date = parseDate(dateString);

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
