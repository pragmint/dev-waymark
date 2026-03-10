# Zod Schema Conventions

All runtime schema validation uses Zod 4. These rules apply across `src/schemas/`, `src/parsers/`, and `src/domain/`.

## Type export rule

Never declare `interface` in `src/schemas/`. All exported types must be derived from schemas:

```ts
// correct
export const FooSchema = z.object({ ... })
export type Foo = z.infer<typeof FooSchema>

// wrong — no manual interface declarations
export interface Foo { ... }
```

## Exception: passthrough + transform schemas

When a schema uses `.passthrough()` combined with `.transform()`, `z.infer<>` resolves to the input type (before transform), not the output type. In these cases a manual `type` (not `interface`) is acceptable — add a comment explaining why `z.infer<>` is insufficient:

```ts
// z.infer<> resolves to input shape here; manual type used for post-transform output
export type ParsedFoo = { ... }
```

This exception is narrow: only apply it when `z.infer<>` genuinely cannot express the output type. Default to `z.infer<>` in all other cases.
