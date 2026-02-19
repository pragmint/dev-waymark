import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Summary } from '../schemas/summarySchemas';
import { SummaryDateSchema } from '../schemas/summarySchemas';
import { parseDate } from '../domain/parseDate';
import { parseMarkdown } from '../parsers/markdown';
import { ValidationError } from '../domain/errors';

/**
 * Loads summaries from filesystem
 * Directory structure: resources/summaries/{dd.mm.yyyy}.md
 */
export async function loadSummariesFromFilesystem(): Promise<Summary[]> {
  const dir = 'examples/summaries';

  try {
    const files = await readdir(dir);

    const summaries = await Promise.all(
      files
        .filter(file => file.endsWith('.md'))
        .map(async file => {
          const filePath = join(dir, file);
          const dateString = file.replace('.md', '');

          try {
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

    summaries.sort((a, b) => {
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
