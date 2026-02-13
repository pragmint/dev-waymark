/**
 * Parses a date string in d.m.yyyy or dd.mm.yyyy format to a Date object
 * Example: "27.1.2026" -> Date object
 */
export function parseDate(dateString: string): Date {
  const [day, month, year] = dateString.split('.');
  // Month is 0-indexed in JavaScript Date
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}
