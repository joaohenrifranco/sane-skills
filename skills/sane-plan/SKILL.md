---
name: sane-plan
version: 3.0.0
description: |
  Planning workflow for features, refactors, architecture decisions, and
  implementation scope. Maps the code, defines the problem, compares options,
  records decisions, and routes evidence and validation.
---

# /sane-plan — Planning Workflow

Plans produce PR description sections, branch-scoped staging artifacts, or PR comments. Never implement application code in planning mode.

## Steps

### [SANE-PLAN-STEP-01] Map the code
Read `AGENTS.md`, inspect recent history and the current diff, map relevant callers and consumers, and check prior work. For user-facing work, inspect analytics call sites and identify existing events that can measure the outcome. For refactors, trace construction, dependencies, state ownership, and boundaries end to end.

### [SANE-PLAN-STEP-02] Define the problem
State what breaks or remains unsolved without the change. Challenge whether the requested framing is the simplest useful one and identify existing code that partially solves it. Handle premise, user value, scope, and opportunity cost directly in the plan when relevant. Load the applicable `sane-code` rules for technical structure and read the applicable nested `AGENTS.md`.

### [SANE-PLAN-STEP-03] Align vocabulary
Name every new entity, state, role, or boundary; map it to existing schema and code terminology; and resolve inconsistent names within the change boundary. Use explicit verbs for entity transformations and record source and target entities.

### [SANE-PLAN-STEP-04] Compare alternatives
Present at least two approaches for non-trivial work: a minimal approach and a structural/long-term approach. Include reuse, effort, risks, impact, and what each approach deliberately does not build.

### [SANE-PLAN-STEP-05] Choose and document
Record the problem, alternatives, chosen approach, impact, caveats, migration path, and success criteria. Success criteria should be measurable for product work and should include build, test, regression, and performance expectations where relevant for technical work.

### [SANE-PLAN-STEP-06] Route evidence and validation
Load the applicable `sane-code` rules for technical structure. Add tests,
security, and performance rules according to the change surface. Request runtime,
analytics, browser, or other operational evidence only when the host project
provides an appropriate workflow. Recommend `sane-code` review after
implementation.

## Artifact behavior

When a PR exists, discover its metadata with the repository's GitHub tooling and update only sections owned by `/sane-plan`. If no PR exists, return the plan in the response or stage it under `.local/`. Do not overwrite unrelated PR content.

## Output

End with:

- Problem
- Alternatives Considered
- Chosen Approach
- Impact
- Caveats
- Success Criteria
- Recommended evidence and validation steps

A plan is ready for implementation only after the chosen approach and unresolved vocabulary are clear.
