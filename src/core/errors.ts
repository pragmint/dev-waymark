/**
 * Custom error classes for better error handling
 */

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

/**
 * Type guard to check if error is a known application error
 */
export function isAppError(
  error: unknown
): error is NotFoundError | ValidationError | DataLoadError {
  return (
    error instanceof NotFoundError ||
    error instanceof ValidationError ||
    error instanceof DataLoadError
  );
}

/**
 * Formats an error for logging with context
 */
export function formatErrorForLogging(error: unknown, context?: Record<string, unknown>): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';

  return `[${errorName}] ${errorMessage}${contextStr}`;
}
