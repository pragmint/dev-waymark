import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Summary } from '../../core/data/summaryTypes';
import { SummaryDateSchema } from '../../core/data/summaryTypes';
import { ValidationError } from '../../core/errors';
import { parseDate } from '../../core/utils/dateFormatter';
import { parseMarkdown } from '../../parsers/markdown';

// Pure I/O function - loads summaries from filesystem
export async function loadSummariesFromFilesystem(): Promise<Summary[]> {
  const dir = 'resources/summaries';

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
              console.log(`Invalid date format in filename ${file}`, { error });
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
          const htmlContent = await parseMarkdown(content);

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
      const dateA = parseDate(a.dateString);
      const dateB = parseDate(b.dateString);
      return dateB.getTime() - dateA.getTime();
    });

    console.log(`Loaded ${summaries.length} summaries`);

    return summaries;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('Summaries directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
