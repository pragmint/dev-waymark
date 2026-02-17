import { z } from 'zod';

// Date string in dd.mm.yyyy format
export const SummaryDateSchema = z
  .string()
  .regex(/^\d{1,2}\.\d{1,2}\.\d{4}$/, 'Date must be in dd.mm.yyyy format');

export const SummarySchema = z.object({
  date: SummaryDateSchema,
  dateString: z.string(), // The filename without .md extension (e.g., "16.1.2026")
  htmlContent: z.string(),
  filePath: z.string(),
});

export type Summary = z.infer<typeof SummarySchema>;
export type SummaryDate = z.infer<typeof SummaryDateSchema>;
