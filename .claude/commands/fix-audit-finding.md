# Fix Audit Finding

You are helping the developer resolve a specific code audit finding. Follow this workflow precisely.

## Input

The audit finding to fix is:

$ARGUMENTS

---

## Step 1: Understand the Finding

Read the finding carefully.

Locate every file involved. Read each one before planning any changes.

---

## Step 2: Ask About Guardrails

Before writing any code, briefly describe the issue and proposed fix, then ask which guardrails to add. Present the full menu and recommend the ones that fit — the user can pick any combination or none.

> I've identified this as: **[category]** — [one sentence: problem + proposed fix].
>
> Which guardrails should I add? I'll recommend based on the issue type, but you decide:
>
> | #   | Guardrail                                            | Best for                                                   |
> | --- | ---------------------------------------------------- | ---------------------------------------------------------- |
> | 1   | **ESLint rule** (custom AST rule in `eslint-rules/`) | Forbidden code patterns, structural violations             |
> | 2   | **Pre-existing ESLint Rule** (built-in ESLint)       | Simpler than a custom rule                                 |
> | 3   | **Unit test**                                        | Utility functions, data transforms, parsers, queries       |
> | 4   | **TypeScript type enforcement**                      | Cross-layer data, naming/type mismatches — caught by `tsc` |
> | 5   | **Fitness function script**                          | Naming conventions, file placement, structural invariants  |
> | 6   | **CLAUDE.md update**                                 | Intentional conventions for AI-assisted edits to follow    |
>
> My recommendation: [list numbers, e.g. "1 and 3"] — [one sentence why].
>
> Reply with the numbers you want, "all", or "none".

Wait for the user's answer before proceeding.

---

## Step 3: Implement the Fix

Make the minimum changes necessary to resolve the finding:

- **Don't over-engineer.** If the fix is "extract to a shared utility", create the utility and update call sites — don't redesign surrounding code.
- **Preserve behavior.** If moving or consolidating logic, verify the output is identical.
- **Respect layers.** Domain logic belongs in `src/core/domain/` or `src/domain/`. Shared utilities go in the appropriate domain module, not a catch-all `utils/` file.
- **Follow existing conventions.** Match naming patterns, export styles, and file structure of sibling files.

After each file edit, `bun check` runs automatically. If it fails, fix the issue before moving on.

---

## Step 4: Add Guardrails (per user's answer)

Implement each requested guardrail. Details for each:

### Custom ESLint rule

Rules live in `eslint-rules/` as plain `.js` files and register in `eslint.config.js` under the `local:` plugin.

Read `eslint-rules/no-nested-try.js` as the reference implementation. Registration pattern:

```js
import myRule from './eslint-rules/my-rule-name.js'
// in the config object:
plugins: { local: { rules: { 'no-nested-try': noNestedTry, 'my-rule-name': myRule } } }
rules: { 'local/my-rule-name': 'error' }
```

Confirm `bun check` still passes after adding.

### `no-restricted-imports`

Add to the `rules` block in `eslint.config.js`. Example — block domain from importing frontend:

```js
'no-restricted-imports': ['error', { patterns: ['*/frontend/*'] }]
```

Use `patterns` for path-based restrictions, `paths` for exact module names.

### Unit test

Tests are `*.test.ts` files co-located with their source. Run with `bun test <path>`.

Write tests for the fixed code. Cover: expected behavior of the extracted/consolidated logic, relevant edge cases, and anything that would catch regression if the fix were accidentally reverted.

### TypeScript type enforcement

Use the type system to make the violation a compile error. Options:

- **Branded/opaque types** — prevent mixing structurally identical but semantically different values
- **Discriminated unions** — replace string literals with typed variants
- **`readonly`** — prevent unintended mutation
- **Module-level type exports** — only expose what callers should see

Confirm `tsc` (part of `bun check`) catches violations.

### Fitness function script

Create a standalone script (e.g. `scripts/check-<invariant>.ts`) that asserts an architectural invariant by inspecting source files. It should exit non-zero on violation so it can run in CI. Example invariants: "every file in `src/loaders/` matches `load*FromFilesystem.ts`", "no file in `src/domain/` imports from `src/frontend/`".

### CLAUDE.md update

Add a concise rule to the relevant section of `CLAUDE.md` — one or two sentences describing the correct pattern and why. Place it near the most relevant existing guidance (layer responsibilities, code style, etc.).

---

## Step 5: Summarize

Report back with:

- What files were changed and why
- Which guardrails were added and what each one catches or enforces
- Any follow-on findings that became visible during the fix (note them, don't fix them)
