// Date format conversion utilities for insights page

/**
 * Parse date in format dd.m.yyyy to Date object
 */
export function parseDataDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('.');
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Convert date from data format (dd.m.yyyy) to HTML5 date input format (yyyy-mm-dd)
 */
export function dataDateToInputDate(dateStr: string): string {
  const date = parseDataDate(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert date from HTML5 date input format (yyyy-mm-dd) to data format (dd.m.yyyy)
 */
export function inputDateToDataDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${parseInt(day)}.${parseInt(month)}.${year}`;
}

/**
 * Format date from data format (dd.m.yyyy) to readable format (January 27, 2026)
 */
export function formatDataDateForDisplay(dateStr: string): string {
  const date = parseDataDate(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
}
