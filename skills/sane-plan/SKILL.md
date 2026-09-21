---
name: sane-plan
version: 4.0.0
description: |
  Opinionated planning for features, refactors, and architecture decisions. Chooses
  the smallest design that protects real ownership, dependency, consistency, and
  evolution boundaries, with explicit tradeoffs and concise implementation scope.
---

# /sane-plan — Smallest Defensible Design

Planning mode decides what should change and why; it does not implement application
code. Follow repository guidance and load the applicable `sane-code` rules before
making technical recommendations.

## Operating position

Prefer direct changes in the existing owner. Introduce a seam, service, contract,
state machine, queue, cache, shared model, or migration only when it protects a
concrete ownership, dependency, consistency, or independent-evolution boundary.
Keep business policy independent of delivery and infrastructure, make state and
side-effect ownership explicit, and keep strong consistency local to a named
boundary.

Reject speculative abstraction, symmetry for its own sake, broad cleanup disguised
as prerequisite work, and distributed machinery for failures that can be handled
locally. Also reject a superficially small patch when it hides ownership, couples
independently changing contexts, or relies on exactly-once behavior. Visible wiring,
translation, durable progress, reconciliation, or limited duplication are acceptable
costs when they protect a real boundary; otherwise prefer less machinery.

## Steps

### [SANE-PLAN-MAP-CODE] Map the code

Inspect only enough of the current path to locate behavior, state, side effects,
callers, consumers, and the owner of each relevant decision. Start with repository
instructions and nearby code and tests. Consult history, analytics, operational data,
or distant consumers when they resolve a live uncertainty; do not collect them by
ritual. For refactors, trace construction and dependencies across the boundary being
changed, not the entire system.

### [SANE-PLAN-DEFINE-PROBLEM] Define the problem

State the observable problem, the invariant or capability that is missing, and the
consequence of doing nothing. Separate requested implementation from required
outcome, identify code that already owns part of the behavior, and exclude unrelated
improvements. If the request is already solved, belongs to another owner, or does not
justify its cost, recommend no change or a narrower change.

### [SANE-PLAN-ALIGN-VOCABULARY] Align vocabulary

Name only concepts needed to make ownership, state, transformations, or contracts
unambiguous. Reuse established domain language and state source and target when data
crosses a boundary. Resolve ambiguity inside the change, but do not launch repository-
wide renames or invent entities merely to make the plan look complete.

### [SANE-PLAN-COMPARE-ALTERNATIVES] Compare alternatives

Choose the smallest design that preserves the identified boundaries. Compare another
approach only when there is a material decision: for example, direct code versus a
new boundary, local consistency versus asynchronous coordination, or reuse versus
translation. Describe the concrete benefit, cost, failure mode, and future constraint
of viable options; dismiss dominated or speculative alternatives briefly rather than
manufacturing a fixed option count.

Prefer:

- direct code over indirection without an independent reason to change;
- one explicit owner over shared mutation;
- local transactions over distributed consistency;
- translated contracts over shared internal models across evolving contexts;
- explicit idempotency, durable state, and reconciliation when work can repeat,
  overlap, arrive late, or partially complete.

Exceptions are bounded by the evidence: duplication may be cheaper than coupling,
a tactical adapter may be safer than immediate migration, and an existing imperfect
pattern may be retained when changing it would expand risk beyond the problem.

### [SANE-PLAN-CHOOSE-DESIGN] Choose and document

Record the chosen design, why it is the smallest defensible option, the owner of new
state and side effects, affected contracts, implementation scope, migration or
rollout needs, and deliberately deferred work. Make caveats and reversibility clear.
Success criteria should describe observable behavior and relevant failure recovery;
do not require metrics, performance targets, migrations, or compatibility machinery
when the change does not create those concerns.

### [SANE-PLAN-ROUTE-VALIDATION] Route evidence and validation

Recommend the least evidence that can disprove the risky assumptions and demonstrate
the intended behavior. Include focused tests and build or type checks when applicable;
add security, performance, browser, analytics, migration, concurrency, or operational
validation only when the change surface warrants it. Name evidence that is unavailable
and the resulting risk instead of prescribing unsupported process. Recommend
`sane-code` review after implementation when production code changes.

## Artifact behavior

When a PR exists and the host provides suitable tooling, update only content clearly
owned by `/sane-plan`; never overwrite unrelated PR text. Otherwise return the plan
in the response or use an explicitly requested local staging location. Do not create
committed planning artifacts by default.

## Output contract

Return a concise plan with:

- **Problem and boundary** — observable need, scope, owner, and relevant invariant;
- **Chosen design** — smallest defensible approach and implementation slices;
- **Tradeoffs** — rejected material alternatives, accepted costs, and bounded exceptions;
- **Impact** — contracts, state, migration, rollout, or compatibility effects that actually apply;
- **Validation** — focused evidence, success criteria, and remaining uncertainty.

A plan is ready when ownership and vocabulary are clear enough to implement and no
unresolved decision can materially change the design. Minor implementation details
may remain with the implementer.
