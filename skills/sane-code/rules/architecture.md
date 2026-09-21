# Architecture Rules

Opinionated defaults for domain-centered systems with inward dependencies, explicit ownership, local consistency, and translated integration boundaries.

### [SANE-ARCH-RESPONSIBILITY-OWNERSHIP] Organize code around responsibility and ownership

Keep domain policy, application orchestration, presentation, persistence, and infrastructure under distinct owners because they change for different reasons. Prefer direct code within one owner; introduce a boundary only when responsibility, lifecycle, or independent evolution actually differs. Do not create layers solely to mirror a generic architecture diagram.

### [SANE-ARCH-INWARD-DEPENDENCIES] Point dependencies toward domain policy

Source-code dependencies should point from presentation and infrastructure toward application and domain policy. Domain code must not depend on orchestration, transport, persistence, frameworks, or process state. Infrastructure implements ports owned by its consumers; do not reshape domain policy around an infrastructure API merely to avoid an adapter.

### [SANE-ARCH-COMPOSITION-ROOTS] Assemble applications at composition roots

Construct each application's object graph at an explicit composition root and inject concrete adapters into consumers. Business code must not discover collaborators through service locators, global registries, hidden process state, or locally constructed fallbacks. Accept visible wiring as the cost of making runtime choices and lifecycles explicit.

### [SANE-ARCH-BOUNDARY-TRANSLATION] Translate representations at boundaries

Convert transport payloads, database records, framework objects, and vendor models into domain concepts when they enter the domain, and translate results on exit. Do not let external representations become the domain model. The mapping code is intentional duplication that protects business policy from externally driven change.

### [SANE-ARCH-SINGLE-STATE-OWNER] Give mutable state one owner

Every mutable value and state transition must have one authoritative owner and update path. Other components may hold derived views or caches, but they must not become competing sources of truth. When several components need to coordinate a transition, route the decision through the owner rather than synchronizing duplicated flags.

### [SANE-ARCH-CONSUMER-OWNED-PORTS] Introduce ports at real boundaries

Define a narrow port from the consumer's needs when a dependency is external, independently replaceable, or would otherwise reverse dependency direction. Keep direct calls within one ownership boundary; do not add interfaces for every class or speculative implementation. Ports buy isolation and replaceability at the cost of mapping and wiring, so each port must protect a concrete boundary.

### [SANE-ARCH-DOMAIN-LANGUAGE] Name behavior in domain language

Name operations for the domain decision or transformation they perform, including source and result concepts when conversion occurs. Avoid vague coordinative names such as `process`, `handle`, or `manage` when a precise domain verb exists. Technical names are appropriate in adapters; they must not displace domain language in policy code.

### [SANE-ARCH-FALLBACK-OWNERSHIP] Define fallback policy where absence gains meaning

The boundary that interprets an absent or unavailable value owns the fallback decision. Lower layers should preserve absence or failure unless their contract gives it domain meaning. Do not scatter convenient defaults across layers; accepting a fallback means accepting its behavior as part of the owning boundary's contract.

### [SANE-ARCH-EFFECT-ISOLATION] Isolate effects from decisions

Keep domain decisions deterministic and execute network calls, persistence, subscriptions, timers, and process mutation through explicit application or infrastructure boundaries. Give every effect and lifecycle one owner. Do not hide effects in constructors, accessors, domain value objects, or implicit module initialization.

### [SANE-ARCH-STATIC-MODULE-GRAPH] Keep the module graph static by default

Use static, side-effect-free imports so dependencies and initialization order remain inspectable. Dynamic loading is reserved for an explicit runtime boundary such as plugins or for a measured loading benefit; its policy, failure behavior, and lifecycle need an owner. Do not use dynamic loading to conceal cycles or defer ordinary construction.

### [SANE-ARCH-EXPLICIT-POLICIES] Model divergent policies explicitly

Use separate operations, strategies, or domain types when modes have different rules or lifecycles. A boolean or string option is acceptable for a small local variation, but must not select substantially different workflows behind one nominal operation. Accept an additional type or entry point when it makes policy differences visible to callers.

### [SANE-ARCH-MODULE-APIS] Expose deliberate module APIs

Create a public entry point only for a module or package that owns a real API boundary. Within that boundary, prefer imports that preserve the origin and dependency direction of code. Do not use barrels or re-exports to manufacture a uniform surface, obscure ownership, or hide cycles.

### [SANE-ARCH-BOUNDED-CONTEXTS] Preserve bounded contexts and their language

Organize domain behavior around cohesive business capabilities, each with language and rules that are internally consistent. When the same term has different meanings, lifecycles, or invariants, model it separately in each context rather than forcing a universal enterprise model. Accept duplicated data and translation as the cost of independent evolution.

### [SANE-ARCH-LOCAL-CONSISTENCY] Keep strong consistency inside explicit boundaries

Group only state that must change atomically to preserve a business invariant, and give one aggregate or domain owner authority over that boundary. Do not build large aggregates for navigational convenience or require synchronous consistency across independent owners. Across boundaries, expose progress and coordinate with durable state, events, compensation, or reconciliation.

### [SANE-ARCH-DOMAIN-POLICY] Put business decisions in the domain

Application code coordinates use cases, transactions, domain behavior, and external ports; domain code makes business decisions and enforces business invariants. Do not place policy in controllers, handlers, jobs, repositories, or UI components, and do not make domain objects perform transport or persistence workflows. Simple data operations may remain simple; introduce domain objects when behavior or invariants justify them.

### [SANE-ARCH-CONTEXT-CONTRACTS] Translate between contexts through contracts

Integrate independently evolving contexts with purpose-specific commands, events, or data contracts and translate them at the consuming boundary. Do not expose persistence models or reuse one context's domain model as another's internal model. Version contracts deliberately and accept mapping work to prevent semantic and release coupling.
