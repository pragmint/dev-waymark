# Fix Audit Finding

You are helping the developer resolve a specific code audit finding. Follow this workflow precisely.

## Input

Optional hint from the user (may be empty):

$ARGUMENTS

---

## Step 1: Select a Finding

**Find all audit files** in the project root — files matching `audit-*.md`.

Read each one and collect every finding that is still present.

Present a numbered list to the user in this format:

> **Open audit findings:**
>
> | #   | Severity | Title       | File              | Audit                     |
> | --- | -------- | ----------- | ----------------- | ------------------------- |
> | 1   | HIGH     | Short title | `path/to/file.ts` | `audit-foo-2026-03-09.md` |
> | 2   | MEDIUM   | ...         | ...               | ...                       |
>
> Which finding should I fix? Reply with a number.

If `$ARGUMENTS` contains a clear reference to a finding (a number, a title, a file name), pre-select it and confirm with the user instead of listing all options.

**Fix only one finding.** Wait for the user to confirm or select before continuing.

---

## Step 2: Understand the Finding

Read the selected finding carefully.

Locate every file involved. Read each one before planning any changes.

---

## Step 3: Ask About Guardrails

Before writing any code, briefly describe the issue and proposed fix, then ask which guardrails to add. Present the full menu (and add any additional guardrails that are applicable) and recommend the ones that fit — the user can pick any combination or none.

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
> | 7   | **Claude Command Hook**                              | Add a new Claude Command Hook to verify this               |
> | 8   | **Claude Agent Hook**                                | Add a new Claude Agent Hook to verify this                 |
> | 9   | **Static Code Analysis**                             | Use a static code analysis tool to prevent future issues   |
>
> My recommendation: [list numbers, e.g. "1 and 3"] — [one sentence why].
>
> Reply with the numbers you want, "all", or "none".

Wait for the user's answer before proceeding.

---

## Step 4: Compact Context

Before writing any code, run `/compact` to clear accumulated context from the investigation steps. This keeps the fix focused and avoids context pressure mid-edit.

After compacting, confirm to the user: "Context compacted — starting the fix now."

---

## Step 5: Implement the Fix

Make the minimum changes necessary to resolve the finding:

- **Don't over-engineer.** If the fix is "extract to a shared utility", create the utility and update call sites — don't redesign surrounding code.
- **Preserve behavior.** If moving or consolidating logic, verify the output is identical.
- **Respect layers.** Domain logic belongs in `src/core/domain/` or `src/domain/`. Shared utilities go in the appropriate domain module, not a catch-all `utils/` file.
- **Follow existing conventions.** Match naming patterns, export styles, and file structure of sibling files.

After each file edit, `bun check` runs automatically. If it fails, fix the issue before moving on.

---

## Step 6: Add Guardrails (per user's answer)

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

## Step 7: Remove the Finding from the Audit File

Now that the fix is complete, delete the resolved finding from the audit file it came from.

Remove the entire finding block — from its `### [SEVERITY] <title>` heading down to (and including) the `---` separator that follows it.

Also update the **Summary** table in that audit file to decrement the count for the resolved finding's severity. If all findings are now resolved, add a note at the top of the Summary:

> ✓ All findings resolved.

Do not remove the audit file itself — it serves as a historical record.

---

## Step 8: Summarize

Report back with:

- What files were changed and why
- Which guardrails were added and what each one catches or enforces
- Confirmation that the finding was removed from the audit file
- Any follow-on findings that became visible during the fix (note them, don't fix them)
