# Audit: AI Harnesses & Guardrail Engineering

**Date**: 2026-03-09
**Scope**: Evaluate the current AI harness infrastructure against the three-pillar model (context engineering, architectural constraints, automated garbage collection), identify gaps, and recommend additions
**Files examined**: 65+

---

## Summary

This codebase already implements a sophisticated multi-layer harness with post-edit hooks, pre-commit fitness functions, custom ESLint rules, completion-gate agents, and documented architectural contracts. The three primary pillars of harness engineering are partially in place: architectural constraints are the strongest layer, context engineering is decent (CLAUDE.md + agent memory), and automated garbage collection is the weakest area. The main gaps are the absence of a CI/CD server-side enforcement layer, no full dependency graph validation, and no automated documentation staleness detection. Overall, the harness is more mature than most codebases but has meaningful blind spots.

| Severity | Count |
| -------- | ----- |
| Critical | 1     |
| High     | 2     |
| Medium   | 4     |
| Low      | 2     |
| Info     | 3     |

---

## Findings

### [CRITICAL] No Server-Side Harness Enforcement (CI/CD Gap) — `(none)`

**Category**: Missing Infrastructure
**Location**: Project root — no `.github/workflows/` directory exists

All harness enforcement is local-only: the post-edit hook, pre-commit fitness function, and completion-gate agents all run on the developer's machine. There is no server-side enforcement layer. This means that:
- A developer can bypass the pre-commit hook with `--no-verify`
- Pull requests from forks or alternative tools skip all checks
- No record exists of which checks passed/failed on any given commit

Without server-side enforcement, the entire harness relies on developer discipline. The "banning manual code entry" philosophy only works if the CI system independently validates every change.

**Suggested fix**: Add a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `bun check && bun test` on every push and pull request. This turns local guardrails into server-enforced gates.

---

### [HIGH] Dependency Graph Validation Is Incomplete — `eslint.config.js`

**Category**: Architectural Constraint Gap
**Location**: `eslint.config.js:~60` (the `no-restricted-imports` rule)

The layer dependency rule ("Domain, loaders, and handlers must never import from `src/frontend/`") is enforced only for `src/frontend/scripts/*`. It does not cover:
- `src/frontend/Pages/**` imports from domain/loaders/handlers (only the reverse is blocked)
- Cross-handler imports (handlers importing other handlers)
- Loaders importing parsers from the wrong direction
- Domain importing from loaders or handlers

The documented data flow is `Loaders → Parsers → Domain → Handlers → Pages`, but ESLint only enforces one edge of this graph. An agent that violates this layering would not be caught by existing tools.

**Suggested fix**: Add a fitness function script (similar to `check-no-manual-interfaces-in-schemas.ts`) that imports from a tool like `madge` or parses TypeScript imports directly to validate the full directed dependency graph matches the documented architecture.

---

### [HIGH] No Immutability Enforcement in Domain Layer — `src/core/domain/`

**Category**: Missing Architectural Constraint
**Location**: `src/core/domain/` (14 files)

The domain layer is documented as "pure business logic," but there is no linting rule preventing mutation patterns (e.g., `array.push()`, `Object.assign()`, `delete obj.key`, direct property assignment). An AI agent writing domain code could silently introduce side effects that violate the purity guarantee the bun-tester agent relies on.

This matters because the purity-first testing philosophy assumes domain functions are referentially transparent. Mutating functions break this assumption without any compile-time or lint-time signal.

**Suggested fix**: Add an ESLint rule (e.g., `fp/no-mutation` from `eslint-plugin-fp`) scoped to `src/core/domain/**` that forbids imperative mutations. Alternatively, write a custom local rule similar to `no-nested-try` that flags `.push(`, `.splice(`, `delete `, and direct `[x] =` in domain files.

---

### [MEDIUM] No Data Lineage Validation — `src/loaders/`

**Category**: Missing Fitness Function
**Location**: `src/loaders/` (17 files) + `examples/` and `resources/`

Loaders read YAML and Markdown from hardcoded paths (`examples/teams/*.yaml`, `resources/capabilities/*.md`, etc.). There is no fitness function that validates these paths are consistent with what's actually present on the filesystem. If an AI agent renames a loader target or adds a new data path, the mismatch is only caught at runtime.

This creates a silent failure mode: a misconfigured loader returns empty data with no build-time signal that anything is wrong.

**Suggested fix**: Add a fitness function that reads all loader files, extracts glob patterns or path templates via regex, and verifies that at least one matching file exists in the expected directory. Run this as part of `bun check:commit`.

---

### [MEDIUM] CLAUDE.md Not Validated Against Code — `CLAUDE.md`

**Category**: Documentation Decay / Missing Garbage Collection
**Location**: `CLAUDE.md` (lines 14, 28-40, 48-57)

CLAUDE.md documents specific file paths (`src/handlers/`, `src/loaders/`, `src/core/domain/`, etc.), naming patterns, and shared utility locations. None of this is validated programmatically. If an AI agent refactors the codebase and renames a directory, CLAUDE.md will silently drift out of sync — the very documentation the agent reads to operate correctly.

This is the "automated garbage collection" pillar the harness most obviously lacks.

**Suggested fix**: Add a lightweight fitness function that asserts key paths mentioned in CLAUDE.md exist on disk (e.g., `src/core/domain/`, `src/loaders/isEnoentError.ts`, `src/schemas/`). A failing assertion surfaces documentation drift immediately. This can be a 20-line script added to `bun check:commit`.

---

### [MEDIUM] Completion Gate Bypass Is Undocumented — `.claude/settings.json`

**Category**: Context Engineering Gap
**Location**: `.claude/settings.json` (`.no-hooks` file mechanism)

The post-completion agents (bun-tester, code-standardizer) can be skipped by creating a `.no-hooks` file. This escape hatch exists for planning mode but is not documented in CLAUDE.md or the agent specs. An AI agent operating autonomously may not know this bypass exists — but a developer could use it to silently skip quality gates without leaving a trace.

**Suggested fix**: Document the `.no-hooks` bypass mechanism in CLAUDE.md with a clear note that it must not be used during normal development sessions. Consider logging when it is used (e.g., have the hook check script emit a warning to stdout when bypassed).

---

### [MEDIUM] No Documented E2E Coverage Requirements — `playwright.config.ts`

**Category**: Missing Constraint Definition
**Location**: `test/e2e/` + `playwright.config.ts`

Playwright E2E tests exist with Chromium/Firefox/WebKit coverage, but there is no documentation specifying which user journeys require E2E tests. Without this, an AI agent adding a new route or feature has no signal about whether it needs an E2E test. Over time, the E2E suite may drift from covering the critical paths.

**Suggested fix**: Add a section to CLAUDE.md listing the critical user journeys that must have E2E coverage (e.g., "team detail page loads", "overview metrics render"). This acts as a specification that agents and developers can check against.

---

### [LOW] Agent Memory Not Backed by Fitness Functions — `.claude/agent-memory/`

**Category**: Context Engineering Gap
**Location**: `.claude/agent-memory/bun-tester/MEMORY.md`, `.claude/agent-memory/code-standardizer/MEMORY.md`

Both specialized agents maintain long-term memory files. These memory files are read at conversation start and influence agent behavior. However, there is no mechanism to detect when a memory file becomes stale or contradicts the actual codebase state. A memory entry documenting a pattern that no longer exists could cause an agent to make systematically wrong decisions.

**Suggested fix**: Add a periodic review step (could be another Claude Code agent or a manual checklist) to validate that memory file entries still match current code reality. Flag memory files older than 30 days for review.

---

### [LOW] No Performance or Complexity Profiling — `package.json`

**Category**: Missing Architectural Constraint
**Location**: `eslint.config.js` + `package.json`

The cyclomatic complexity ESLint rule (`cyclomatic-complexity/zee-codeBlockComplexity`) catches structurally complex functions, but there is no profiling for runtime performance: N+1 filesystem reads, unbounded array operations over large datasets, or synchronous blocking in async contexts. As the data volume in `examples/` grows, these silent performance issues will compound.

**Suggested fix**: Add a lint rule or fitness function that flags synchronous file reads (`readFileSync`) in loader files, and consider adding a maximum line count check on parser/loader files to prevent them from accumulating too much logic over time.

---

### [INFO] No Harness for Schema Drift Between YAML Files and Schemas — `src/parsers/`

**Category**: Observation
**Location**: `src/parsers/yaml/`, `examples/`

Zod schemas validate YAML files at runtime, but there is no pre-commit check that runs parsers against the example files to catch schema drift before it hits production. A schema change that breaks existing YAML data is only caught when the app actually loads that data.

**Suggested fix**: Add a smoke-test script that runs all loaders against the `examples/` directory as part of `bun check:commit`. This is essentially a "does the app start without parse errors" check.

---

### [INFO] No Observability or Live Agent Feedback Loop — `(none)`

**Category**: Context Engineering Gap
**Location**: N/A

The "context engineering" pillar of harness engineering includes giving agents live observability: browser data, runtime errors, server logs. Currently, agents operate without access to live app state. They cannot observe what the app renders, what errors it throws at runtime, or how data flows through the system end-to-end.

**Suggested fix**: Consider adding a dev-mode endpoint (e.g., `GET /debug/state`) that dumps current loader output and domain data as JSON. This gives agents a structured view of what the app currently knows, enabling them to validate their changes against live behavior.

---

### [INFO] Skill Inventory Not Codified as Machine-Readable Constraints — `.claude/skills/`

**Category**: Context Engineering
**Location**: `.claude/skills/` (audit, fix-audit-finding, simplify, etc.)

The project has a growing set of Claude Code skills (audit, fix-audit-finding, simplify, library-implementer, etc.). These are documented as skill files but there is no index or discovery mechanism. As the skill inventory grows, agents may duplicate functionality or use the wrong skill for a task.

**Suggested fix**: Add a `.claude/skills/README.md` that lists each skill, its trigger conditions, and what it should NOT be used for. This acts as a skill routing guide for the orchestrating agent.

---

## What looks good

- **Post-edit hook is fast and blocking**: Running `bun check` after every edit creates a tight feedback loop that catches formatting, type, and lint issues before they accumulate.
- **Pre-commit fitness function for schema types**: The `check-no-manual-interfaces-in-schemas.ts` script is a textbook example of a targeted fitness function — narrow scope, binary outcome, blocks commits automatically.
- **Custom ESLint rules**: `no-inline-enoent-check` and `no-nested-try` demonstrate the right pattern for encoding architectural decisions as machine-enforced constraints.
- **Layer import enforcement**: The `no-restricted-imports` rule in ESLint successfully prevents the most common and dangerous layer violation (frontend imports in domain/loader code).
- **Specialized agents with memory**: The bun-tester and code-standardizer agents with persistent memory represent genuine "automated enforcement" agents, not just documentation.
- **Zod 4 throughout**: Runtime validation is consistent, schema-derived types are enforced, and parsers are co-located with their schemas.
- **Purity-first domain layer**: The `src/core/domain/` convention of pure functions makes the codebase highly testable and agent-friendly.
- **CLAUDE.md is genuinely useful**: The architecture documentation is detailed enough that an AI agent can make correct decisions about file placement, imports, and naming without reading the whole codebase.
- **Cyclomatic complexity enforcement**: The custom complexity rule keeps functions cognitively manageable, which is essential when AI agents read and modify them.

---

## Recommended next steps

1. **Add a CI/CD workflow** _(addresses: No Server-Side Harness Enforcement)_
   Create `.github/workflows/ci.yml` running `bun check && bun test` on every push. This is the single highest-leverage addition — without it, all local guardrails are optional.

2. **Add a full dependency graph fitness function** _(addresses: Dependency Graph Validation Is Incomplete)_
   Write a script that validates the full directed import graph matches the documented layer order. This closes the largest gap in architectural constraint enforcement.

3. **Add CLAUDE.md validation and data lineage checks** _(addresses: CLAUDE.md Not Validated, Data Lineage Validation)_
   Two small fitness functions added to `bun check:commit`: one verifying key paths in CLAUDE.md exist on disk, one verifying loader glob patterns match actual files. Together these implement basic "automated garbage collection."

4. **Add immutability linting to the domain layer** _(addresses: No Immutability Enforcement in Domain Layer)_
   Scope `eslint-plugin-fp` mutation rules to `src/core/domain/`. This enforces the purity guarantee that the testing philosophy depends on.

5. **Add test coverage thresholds** _(addresses: No Test Coverage Enforcement)_
   Run `bun test --coverage --coverage-threshold 80` for the domain layer as part of the pre-commit check. Start at a threshold that passes today and incrementally raise it.
