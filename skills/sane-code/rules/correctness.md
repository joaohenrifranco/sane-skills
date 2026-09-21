# Correctness Rules

Opinionated defaults for systems that assume external work can fail, repeat, overlap, arrive late, or complete only partially.

### [SANE-CORRECT-BOUNDARY-CONTRACTS] Specify observable boundary contracts

Define accepted inputs, returned outcomes, visible effects, invariants, and failure semantics at public, process, persistence, and context boundaries. Express the contract with types, schemas, tests, or concise documentation. Internal helpers need only the contract required by their owner; do not bury important behavior in implementation details or document every private function ceremonially.

### [SANE-CORRECT-VALIDATE-TRUST-TRANSITIONS] Validate once when trust or representation changes

Parse, normalize, and validate data as it enters a more trusted or constrained representation, then let internal code rely on that representation. Validate dependency responses and revalidate when data crosses into another context with different rules. Reject malformed or unsupported values instead of spreading defensive parsing or silent coercion throughout the system.

### [SANE-CORRECT-INVARIANTS-ALL-PATHS] Preserve invariants on every completion path

Success, rejection, failure, retry, cancellation, and partial completion must leave owned state within its invariants. Commit changes atomically when observers must see them together. If atomicity ends at a boundary, represent intermediate progress explicitly rather than pretending the whole workflow committed at once.

### [SANE-CORRECT-EXPLICIT-STATES] Model behaviorally distinct states separately

Use explicit domain states when values permit different actions or transitions; avoid collections of booleans that allow contradictory combinations. Distinguish absent, empty, pending, rejected, failed, and completed only where behavior differs. Prefer making invalid combinations unrepresentable, but do not introduce a state machine for data with no meaningful lifecycle.

### [SANE-CORRECT-CONFLICTING-WRITES] Reject stale and conflicting writes

Give concurrent mutation a serialization point at the state owner. When work can overlap, use versions, preconditions, uniqueness constraints, or another explicit conflict mechanism rather than accidental last-write-wins behavior. Before committing asynchronous work, verify that its input still applies; permit last-write-wins only when the contract intentionally makes lost intermediate updates harmless.

### [SANE-CORRECT-AT-LEAST-ONCE] Design external execution as at least once

Assume requests, jobs, messages, callbacks, and user actions can be repeated unless the surrounding protocol proves otherwise. Make consequential effects idempotent or deduplicated at their owner, and persist the identity needed to recognize repetition. Retry only classified transient failures with bounded attempts and backoff; never use retries to mask a deterministic failure.

### [SANE-CORRECT-EXPLICIT-UNCERTAINTY] Represent uncertainty instead of reporting success

A timeout, incomplete operation, unknown validation result, or indeterminate dependency response is not success. Fail closed when authorization, integrity, or safety is uncertain; otherwise return an explicit pending, unavailable, or indeterminate outcome. A fallback is valid only when the owning contract defines the degraded behavior and tests its consequences.

### [SANE-CORRECT-EXPECTED-FAILURES] Make expected failure part of the contract

Represent expected business rejection and recoverable operational failure with stable result types, error types, codes, or statuses that tell callers what they may do next. Reserve unclassified failures for defects or unavailable dependencies, preserving their cause for diagnosis. Never branch on human-readable messages or collapse distinct remedies into one generic error.

### [SANE-CORRECT-CANCELLATION-OWNERSHIP] Give cancellation and cleanup one owner

The owner that starts cancellable work owns its cancellation signal, acquired resources, and cleanup. Cancellation must stop or safely detach work, release resources exactly once, and prevent late completion from mutating newer state. Define the commit point after which cancellation cannot undo success; cleanup must tolerate partial initialization and repeated invocation.

### [SANE-CORRECT-CONFIGURATION-VALIDATION] Validate configuration before serving work

Treat configuration as typed input, validate it at startup or activation, and fail before dependent work begins when required values are absent, invalid, or unsupported. Prefer immutable configuration for a running component. When live reconfiguration is a real requirement, publish versioned snapshots and define which snapshot in-flight work observes rather than reading mutable process state ad hoc.

### [SANE-CORRECT-CONTROLLED-NONDETERMINISM] Control nondeterminism that affects outcomes

Inject or capture clocks, randomness, ordering, locale, and environment state when they affect a result or must be reproduced. Represent instants independently of display time zones, retain zone rules for civil-time schedules, and make units, precision, rounding, overflow, collation, and tie-breaking explicit at affected boundaries. Do not abstract nondeterminism that has no observable consequence.

### [SANE-CORRECT-DURABLE-PROGRESS] Make distributed progress durable and reconcilable

Keep atomic commits local to one transactional owner. When a workflow crosses that boundary, commit local state and durable intent together where possible, perform external effects idempotently, and record enough progress to resume or reconcile after failure. Expose pending or partial outcomes when they matter; do not report success before every commitment required by the contract is durable or rely on exactly-once delivery.
