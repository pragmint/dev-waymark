import type { Context } from 'hono';
import { NotFoundError, isAppError, formatErrorForLogging } from '../../core/errors';

/**
 * Global error handler middleware for Hono
 * Catches errors and returns appropriate HTTP responses
 */
export async function errorHandler(err: Error, c: Context) {
  // Log the error with context
  console.log(formatErrorForLogging(err, { path: c.req.path, method: c.req.method }));

  // Handle known application errors
  if (isAppError(err)) {
    if (err instanceof NotFoundError) {
      return c.text(err.message, 404);
    }

    // ValidationError and DataLoadError are server errors
    return c.text(`Server error: ${err.message}`, 500);
  }

  // Handle unknown errors
  return c.text('An unexpected error occurred', 500);
}
