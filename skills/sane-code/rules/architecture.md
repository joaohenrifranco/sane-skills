# Architecture Rules

Portable guidance for clear boundaries, explicit ownership, and replaceable infrastructure.

### [SANE-ARCH-01] Keep responsibilities coherent

A module should have one primary reason to change. Separate policy, coordination, persistence, presentation, and infrastructure when they evolve independently. Treat multiple responsibilities, excessive configuration surfaces, and deep prop drilling as refactoring signals, not universal numeric violations.

### [SANE-ARCH-02] Keep dependencies directed and acyclic

Dependencies should flow toward lower-level mechanisms through deliberate boundaries. Lower-level modules must not reach upward into orchestration or presentation. Circular dependencies are architecture defects.

### [SANE-ARCH-03] Construct collaborators at the composition root

The runtime owner constructs services, clients, repositories, and other collaborators, then injects them into consumers. Avoid service locators, hidden process state, and fallback instances created inside business logic.

### [SANE-ARCH-04] Keep domain logic independent of infrastructure

Translate external representations at boundaries. Business rules should not directly depend on databases, HTTP clients, filesystems, UI frameworks, environment variables, or process globals.

### [SANE-ARCH-05] Make state ownership and transitions explicit

Every mutable value has one clear owner and update path. Avoid duplicated state and flags whose meaning changes across layers. Represent meaningful lifecycle states explicitly.

### [SANE-ARCH-06] Prefer narrow, replaceable seams

Expose the smallest contract a consumer needs. Keep abstractions near their consumers unless genuinely shared. Use explicit inputs, injected collaborators, and deterministic transformations so core behavior is testable without infrastructure.

### [SANE-ARCH-07] Name transformations precisely

Names should identify source and result entities. Prefer precise domain verbs over vague `process`, `handle`, or `manage`; make conversions between external, domain, and presentation data visible.

### [SANE-ARCH-08] Put fallbacks at the owning boundary

The component that establishes a value defines its fallback policy or exposes absence. Do not scatter defaults that conceal an unclear contract; intentional behavior-changing fallbacks need tests.

### [SANE-ARCH-09] Keep side effects deliberate and recoverable

Locate network calls, persistence, subscriptions, timers, and process mutations at explicit boundaries. Provide cleanup, rollback, retry semantics, or idempotency as appropriate; keep decision logic separate from effect execution.

### [SANE-ARCH-10] Keep module loading intentional

Prefer a static, side-effect-free module graph. Use dynamic loading only for a measured benefit such as a critical-path or bundle improvement, and preserve explicit ownership.

### [SANE-ARCH-11] Avoid boolean mode parameters for divergent behavior

When modes have substantially different policies or lifecycles, use focused functions or an explicit strategy/domain type rather than a boolean that hides divergent paths.

Internal re-exports and barrels should not obscure ownership or create cycles; deliberate public package entrypoints are valid when they define a real API boundary.

## Authoring checklist

Trace entry points, callers, consumers, state owners, side effects, and boundaries before changing structure. Check cycles and hidden construction, then verify important policy can be tested without real infrastructure.