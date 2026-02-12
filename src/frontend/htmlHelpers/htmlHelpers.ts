// Pure helper functions for HTML generation

/**
 * Parses a date string that may be in various formats (European DD.M.YYYY, ISO, etc.)
 * Returns a valid Date object or null if parsing fails
 */
export function parseFlexibleDate(dateString?: string | null): Date | null {
  if (!dateString) return null;

  // Try parsing as-is first (handles ISO format, US format, etc.)
  let date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try European format: DD.M.YYYY or DD.MM.YYYY or D.M.YYYY
  const europeanMatch = dateString.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanMatch) {
    const day = parseInt(europeanMatch[1], 10);
    const month = parseInt(europeanMatch[2], 10) - 1; // JavaScript months are 0-indexed
    const year = parseInt(europeanMatch[3], 10);
    date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

export function getTrendIcon(trend: string): string {
  switch (trend) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
      return '→';
    default:
      return '→';
  }
}

export function getStatusBadge(status: string): string {
  const statusColors: Record<string, { bg: string; text: string }> = {
    'in-progress': { bg: '#e8f4f8', text: '#0066cc' },
    blocked: { bg: '#f8d7da', text: '#721c24' },
    paused: { bg: '#fff3cd', text: '#856404' },
  };

  const colors = statusColors[status] || { bg: '#e0e0e0', text: '#666' };
  const label = status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return `<span class="status-badge" style="background-color: ${colors.bg}; color: ${colors.text};">${label}</span>`;
}

export function getTrendLabel(trend: string): string {
  switch (trend) {
    case 'up':
      return 'Improving';
    case 'down':
      return 'Declining';
    case 'stable':
      return 'Stable';
    default:
      return 'Stable';
  }
}

export function getMaturityLevelLabel(level: number): string {
  switch (level) {
    case 0:
      return 'Not Started';
    case 1:
      return 'Initial';
    case 2:
      return 'Developing';
    case 3:
      return 'Defined';
    case 4:
      return 'Optimizing';
    default:
      return 'Unknown';
  }
}

export function calculateEndDate(startDate?: string | null, duration?: string): string {
  if (!duration) return 'TBD';

  const start = parseFlexibleDate(startDate);
  if (!start) return 'TBD';

  const durationMatch = duration.match(/(\d+)\s*(week|month|day)/i);

  if (!durationMatch) return 'TBD';

  const amount = parseInt(durationMatch[1]);
  const unit = durationMatch[2].toLowerCase();

  const end = new Date(start);
  if (unit.startsWith('week')) {
    end.setDate(end.getDate() + amount * 7);
  } else if (unit.startsWith('month')) {
    end.setMonth(end.getMonth() + amount);
  } else if (unit.startsWith('day')) {
    end.setDate(end.getDate() + amount);
  }

  return end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
