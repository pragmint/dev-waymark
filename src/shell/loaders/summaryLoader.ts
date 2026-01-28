import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { marked } from 'marked';
import { z } from 'zod';
import type { Summary } from '../../core/data/summaryTypes';
import { SummaryDateSchema } from '../../core/data/summaryTypes';
import { ValidationError } from '../../core/errors';
import { consoleLogger } from '../../core/logger';

// Parse date string in dd.mm.yyyy format to a Date object
function parseSummaryDate(dateString: string): Date {
  const [day, month, year] = dateString.split('.');
  // Month is 0-indexed in JavaScript Date
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

// Pure I/O function - loads summaries from filesystem
export async function loadSummariesFromFilesystem(): Promise<Summary[]> {
  const dir = 'resources/private/markdown/summaries';

  try {
    const files = await readdir(dir);

    const summaries = await Promise.all(
      files
        .filter((file: string) => file.endsWith('.md'))
        .map(async (file: string) => {
          const filePath = join(dir, file);
          const dateString = file.replace('.md', '');

          try {
            // Validate date format
            SummaryDateSchema.parse(dateString);
          } catch (error) {
            if (error instanceof z.ZodError) {
              consoleLogger.error(`Invalid date format in filename ${file}`, { error });
              throw new ValidationError(
                'Summary',
                file,
                'Filename must be in dd.mm.yyyy.md format'
              );
            }
            throw error;
          }

          // Read and convert markdown to HTML
          const content = await Bun.file(filePath).text();
          const htmlContent = await marked.parse(content);

          return {
            date: dateString,
            dateString,
            htmlContent,
            filePath,
          };
        })
    );

    // Sort summaries by date, most recent first
    summaries.sort((a: Summary, b: Summary) => {
      const dateA = parseSummaryDate(a.dateString);
      const dateB = parseSummaryDate(b.dateString);
      return dateB.getTime() - dateA.getTime();
    });

    consoleLogger.info(`Loaded ${summaries.length} summaries`);

    return summaries;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      consoleLogger.warn('Summaries directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}

// Get the most recent summary
export function getMostRecentSummary(summaries: Summary[]): Summary | null {
  return summaries.length > 0 ? summaries[0] : null;
}

// Get a specific summary by date string
export function getSummaryByDate(summaries: Summary[], dateString: string): Summary | null {
  return summaries.find(s => s.dateString === dateString) || null;
}
