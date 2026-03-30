---
name: audit
description: >
  Runs a targeted code audit based on user-provided context. Investigates the codebase,
  identifies findings, and writes a structured audit report to the project root. Use this
  skill whenever the user asks to "audit" something — a layer, a pattern, a file category,
  a convention, a security concern, or any other code quality topic.
---

## Goal

Thoroughly investigate the codebase for the issues described by the user, then produce a
structured audit file in the project root documenting every finding.

## Input

The audit topic and any extra context provided by the user:

$ARGUMENTS

---

## Step 1: Clarify scope (if needed)

Read the input. If the audit topic is ambiguous or under-specified, ask **one focused
question** to clarify before starting. Good audits have a clear scope — don't begin a
broad investigation when a narrow one was intended, and vice versa.

If the topic is clear, skip this step entirely.

---

## Step 2: Investigate

Explore the codebase relevant to the audit topic. Exactly what to examine depends on the
topic, but as a guide:

**For pattern / convention audits** (naming, file placement, import rules, etc.)

- Find all files in the relevant directory or layer
- Read a representative sample to understand the expected pattern
- Search for deviations using Grep or Glob

**For layer / architecture audits** (coupling, dependency direction, data flow)

- Trace imports across layers
- Look for imports that cross layer boundaries in the wrong direction
- Check the entry point files

**For duplication audits** (copy-pasted logic, re-implemented utilities)

- Identify clusters of similar code
- Check whether a shared utility already exists but is being bypassed

**For security audits** (injection, unsafe operations, secrets in source)

- Review route handlers for unvalidated user input
- Check file operations for path traversal risks
- Look for hardcoded credentials, tokens, or env var misuse

Be thorough. Read the files, don't just search. Findings should be based on what the code
actually does, not what it might do.

---

## Step 3: Classify findings

For each finding, assign:

- **Severity**: `critical` | `high` | `medium` | `low` | `info`
- **Category**: the type of issue (e.g. "Layer violation", "Missing validation", "Duplicated logic", "Naming inconsistency", "Type unsafety")
- **Location**: file path + line number(s)
- **Description**: what the problem is and why it matters
- **Suggested fix**: the minimum change that resolves it (don't design new systems — point at the fix)

---

## Step 4: Write the audit file

Create a file named `audit-<topic>-<YYYY-MM-DD>.md` in the project root, where `<topic>`
is a short kebab-case label derived from the audit subject (e.g. `audit-layer-imports-2026-03-09.md`).

Use this structure:

```markdown
# Audit: <Title>

**Date**: YYYY-MM-DD
**Scope**: <one sentence describing what was audited>
**Files examined**: <count>

---

## Summary

<2–4 sentences: what you looked at, what you found, overall health assessment>

| Severity | Count |
| -------- | ----- |
| Critical | N     |
| High     | N     |
| Medium   | N     |
| Low      | N     |
| Info     | N     |

---

## Findings

### [SEVERITY] <Short title> — `path/to/file.ts`

**Category**: <category>
**Location**: `path/to/file.ts:LINE`

<Description of the problem and why it matters.>

**Suggested fix**: <Minimum change to resolve this.>

---

(repeat for each finding, ordered by severity descending)

---

## What looks good

<Bullet list of patterns or areas that were audited and found to be correct. Always
include this — a clean audit should say so explicitly.>

---

## Recommended next steps

<Ordered list of the top 3–5 actions the team should take, derived from the findings.
Each item should reference the relevant finding(s) by title.>
```

---

## Step 5: Report back

After writing the file, tell the user:

- The filename of the audit report
- The finding counts by severity
- The top 1–3 most important findings (one sentence each)
- A reminder that each finding can be fixed with the `/fix-audit-finding` command
