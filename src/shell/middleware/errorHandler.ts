import type { Context } from 'hono';

export class NotFoundError extends Error {
  constructor(
    public resourceType: string,
    public resourceId: string
  ) {
    super(`${resourceType} not found: ${resourceId}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(
    public resourceType: string,
    public fileName: string,
    public details: string
  ) {
    super(`Validation failed for ${resourceType} in ${fileName}: ${details}`);
    this.name = 'ValidationError';
  }
}

export class DataLoadError extends Error {
  constructor(
    public resourceType: string,
    public filePath: string,
    public cause?: Error
  ) {
    super(`Failed to load ${resourceType} from ${filePath}: ${cause?.message || 'Unknown error'}`);
    this.name = 'DataLoadError';
  }
}

export function isAppError(
  error: unknown
): error is NotFoundError | ValidationError | DataLoadError {
  return (
    error instanceof NotFoundError ||
    error instanceof ValidationError ||
    error instanceof DataLoadError
  );
}

export function formatErrorForLogging(error: unknown, context?: Record<string, unknown>): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';

  return `[${errorName}] ${errorMessage}${contextStr}`;
}

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
