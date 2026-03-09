/**
 * Type-safe check for Node.js ENOENT (file/directory not found) errors.
 * Use this instead of the verbose inline check in loader catch blocks.
 */
export function isEnoentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    // eslint-disable-next-line local/no-inline-enoent-check
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
