---
name: sane-code
version: 1.0.1
description: |
  Portable code standards and independent review orchestration. Use while
  planning, authoring, refactoring, debugging, testing, or reviewing code, and
  when asked for code review, merge readiness, architecture, correctness,
  security, test, or performance review.
---

# sane-code — Authoring and Review

The canonical generic policies are the five files in `rules/`. Read the applicable
rule files before planning or changing code. Project-specific constraints come
from the repository root and the most specific nested `AGENTS.md`; project rules
explicitly take precedence over generic defaults.

## Authoring mode

Load `architecture.md` and `correctness.md` for production code changes. Add
`tests.md` when observable behavior, branches, recovery, or assertions change.
Add `security.md` for authentication, authorization, data access, secrets,
dependencies, CI/CD, external input, callbacks, or output rendering. Add
`performance.md` for rendering, lists, loops, imports, queries, network paths,
hot paths, or optimization work.

Read the root `AGENTS.md` and every nested `AGENTS.md` applicable to the files
being changed. Do not spawn review agents for ordinary authoring; use the rules
to guide the implementation and validation.

## Review mode

Static review is read-only. Determine the current branch, merge base, PR metadata
when available, changed files, package scopes, applicable `AGENTS.md` files, and
configuration/environment/compatibility implications. If no PR exists, return the
report without creating committed artifacts; publish a comment only when a PR
exists.

### Category routing

Start inclusive when uncertain:

- Any production code: architecture, correctness, tests.
- Auth, authorization, database, external input, secrets, dependencies, or CI/CD:
  add security.
- Rendering, lists, loops, imports, queries, network/data fetching, or hot paths:
  add performance.
- Test-only changes: tests and correctness; add architecture when seams or
  ownership change.
- Configuration-only changes: correctness; add security or performance when
  applicable.
- Documentation-only changes: no code category unless behavior is affected.

### Independent clean-context reviewers

Spawn one independent subagent per selected rules file, preferably in parallel.
Each prompt must include only:

- repository/worktree path;
- merge base or explicit diff scope;
- changed-file list;
- exact generic rules file to read;
- root and applicable nested `AGENTS.md` paths;
- permission to inspect relevant callers, consumers, tests, and history;
- instruction to report actionable findings related to the change only;
- instruction not to edit files;
- this output contract.

Do not pass findings, assumptions, tentative conclusions, or irrelevant standards
from another reviewer.

### Reviewer output contract

Each finding contains:

- `Severity`: `critical`, `warning`, or `info`;
- canonical generic or project rule ID;
- file and line reference;
- observable consequence or failure mode;
- smallest appropriate remedy;
- validation recommendation when relevant.

The reviewer must state when no actionable issue was found and distinguish verified
findings from uncertainty requiring runtime evidence.

### Synthesis

Validate that findings refer to real code and current lines. Deduplicate only when
the underlying concern is the same, preserving the strongest consequence and all
relevant canonical IDs. Resolve severity from concrete impact, separate blocking
findings from warnings and optional improvements, and never claim runtime evidence
that was not collected.

### Re-review

After fixes, run a fresh independent round with current diff and clean contexts.
Do not ask old reviewers to confirm their earlier findings or provide their
reports to the new reviewers.

### Report and PR publishing

Return scope, categories run, blocking findings, warnings, info, validation run or
missing, and remaining risk. If a PR exists, post one new machine-parseable review
comment; do not edit previous comments. Do not create plans or review artifacts in
committed files.
