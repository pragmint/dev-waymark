# Shared Utilities

Utilities that exist to prevent duplication of common patterns. Never reimplement these inline.

## ENOENT error checking

Use `isEnoentError(error)` from `src/loaders/isEnoentError.ts` in all loader catch blocks.

```ts
import { isEnoentError } from '../loaders/isEnoentError'

try { ... } catch (error) {
  if (isEnoentError(error)) return null
  throw error
}
```

Never write the inline check (`error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'`). An ESLint rule (`local/no-inline-enoent-check`) enforces this.

## Date parsing

Two separate utilities exist — use the correct one for the execution context:

| Context | Function | File |
|---|---|---|
| Server-side (Hono handlers, domain, loaders) | `parseDate()` | `src/domain/parseDate.ts` |
| Frontend scripts (`src/frontend/scripts/`) | `parseDataDate()` | `src/frontend/scripts/insights-date-utils.ts` |

Do not duplicate date parsing logic inline in either context.
