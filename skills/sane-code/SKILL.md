---
name: sane-code
version: 6.0.0
description: |
  Portable code standards and independent review orchestration. Use while
  planning, authoring, refactoring, debugging, testing, or reviewing code, and
  when asked for code review, merge readiness, architecture, correctness,
  security, test, performance, UI, or operations review.
---

# sane-code — Authoring and Review

The canonical generic policies are the seven files in `rules/`. Read the applicable
rule files before planning or changing code. Project-specific constraints come
from the repository root and the most specific nested `AGENTS.md`; project rules
explicitly take precedence over generic defaults. Severity levels, the PR comment
envelope, and the handoff packet shared by every `sane-*` workflow live in
`conventions.md`.

## Design position

Prefer direct code until a real ownership, dependency, consistency, or evolution
boundary justifies abstraction (`SANE-ARCH-RESPONSIBILITY-OWNERSHIP`), and assume
external work can fail, repeat, overlap, arrive late, or complete partially
(`SANE-CORRECT-AT-LEAST-ONCE`, `SANE-CORRECT-DURABLE-PROGRESS`). The rules
intentionally accept visible wiring, mapping, and some data duplication to gain
independent evolution and reliable behavior; do not pay those costs where no
protected boundary exists.

Semantic rule IDs are the shared vocabulary for findings and design disagreements.
Cite the ID behind each recommendation so the user can accept it, challenge its
applicability, or override it explicitly in project guidance. Keep an ID stable while
its policy remains the same; wording and headings may evolve without changing it.

## [SANE-CODE-AUTHORING] Authoring mode

Load `correctness.md` for production code changes, and add:

- `architecture.md` when the change alters module boundaries, dependency direction,
  state ownership, a public API, or introduces an abstraction. Localized edits inside
  one owner do not need it.
- `tests.md` when observable behavior, branches, recovery, or assertions change.
- `security.md` for authentication, authorization, data access, secrets,
  dependencies, CI/CD, external input, callbacks, or output rendering.
- `performance.md` for rendering, lists, loops, imports, queries, network paths,
  hot paths, or optimization work.
- `ui.md` for components, views, client-side state, styling, or user-facing text.
- `operations.md` for error handling, logging, background jobs, schema or contract
  changes, migrations, configuration, deployment, or rollout.

Read the root `AGENTS.md` and every nested `AGENTS.md` applicable to the files
being changed. Do not spawn review agents for ordinary authoring; use the rules
to guide the implementation and validation.

## [SANE-CODE-REVIEW] Review mode

Static review is read-only. Determine the current branch, merge base, PR metadata
when available, changed files, package scopes, applicable `AGENTS.md` files, and
configuration/environment/compatibility implications. If no PR exists, return the
report without creating committed artifacts; publish a comment only when a PR
exists.

### [SANE-CODE-ROUTING] Category routing

Select categories from the same triggers as authoring mode. When uncertain, include
the category rather than omit it:

- Any production code: correctness and tests.
- Changed module boundaries, dependency direction, state ownership, or public APIs:
  add architecture.
- Auth, authorization, database, external input, secrets, dependencies, or CI/CD:
  add security.
- Rendering, lists, loops, imports, queries, network/data fetching, or hot paths:
  add performance.
- Components, views, client state, or user-facing text: add ui.
- Error handling, logging, jobs, schema or contract changes, migrations,
  configuration, or deployment: add operations.
- Test-only changes: tests and correctness; add architecture when seams or
  ownership change.
- Configuration-only changes: correctness; add security, performance, or operations
  when applicable.
- Documentation-only changes: no code category unless behavior is affected.

### [SANE-CODE-REVIEWERS] Independent clean-context reviewers

When the host can spawn subagents and the diff is too large for one reviewer to hold
in a single pass, spawn one independent subagent per selected rules file, preferably
in parallel. For a small single-scope diff, one reviewer may read all the selected
rules files. If the host cannot spawn subagents, review each category in sequence
from a fresh statement of scope, rules file, and diff only, do not carry earlier
findings forward, and say in the report that independence was best effort.

Each reviewer prompt must include only:

- repository/worktree path;
- merge base or explicit diff scope;
- changed-file list;
- exact generic rules file to read;
- root and applicable nested `AGENTS.md` paths;
- permission to inspect relevant callers, consumers, tests, and history;
- instruction to report actionable findings related to the change only;
- instruction not to edit files;
- the finding contract below.

Do not pass findings, assumptions, tentative conclusions, or irrelevant standards
from another reviewer.

### [SANE-CODE-FINDING-CONTRACT] Reviewer output contract

Each finding contains:

- `Severity`: `critical`, `warning`, or `info`, as defined in `conventions.md`;
- canonical generic or project rule ID;
- file and line reference;
- observable consequence or failure mode;
- smallest appropriate remedy;
- validation recommendation when relevant.

The reviewer must state when no actionable issue was found and distinguish verified
findings from uncertainty requiring runtime evidence.

### [SANE-CODE-SYNTHESIS] Synthesis

Validate that findings refer to real code and current lines. Deduplicate only when
the underlying concern is the same, preserving the strongest consequence and all
relevant canonical IDs. Resolve severity from concrete impact using the scale in
`conventions.md`, separate blocking findings from warnings and optional improvements,
and never claim runtime evidence that was not collected.

### [SANE-CODE-RE-REVIEW] Re-review

After fixes, run a fresh independent round with current diff and clean contexts.
Do not ask old reviewers to confirm their earlier findings or provide their
reports to the new reviewers.

### [SANE-CODE-REPORT] Report and PR publishing

Return scope, categories run, blocking findings, warnings, info, validation run or
missing, and remaining risk. If a PR exists, post one new review comment in the
envelope defined in `conventions.md`; do not edit previous comments. Do not create
plans or review artifacts in committed files.
