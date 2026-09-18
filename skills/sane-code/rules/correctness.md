# Correctness Rules

Portable guidance for explicit, deterministic behavior under failure, repetition, concurrency, and boundary conditions.

### [SANE-CORRECT-01] Define contracts at boundaries

Make inputs, outputs, side effects, failure modes, and invariants clear for public functions, endpoints, commands, and state transitions. Use explicit types and narrow `unknown` at external boundaries; do not let callers infer behavior from implementation details.

### [SANE-CORRECT-02] Validate inputs and outputs

Validate syntax, type, size, range, encoding, and business constraints when data enters or leaves a boundary. Reject unsupported or incomplete values explicitly rather than allowing accidental downstream failure.

### [SANE-CORRECT-03] Preserve invariants on every path

Success, failure, retry, cancellation, early return, and partial completion must preserve documented invariants. Update related values atomically or transactionally when observers could otherwise see half-applied state.

### [SANE-CORRECT-04] Represent domain states explicitly

Use typed states instead of magic string comparisons and meaningful constants instead of unexplained numbers. Distinguish missing, empty, invalid, and failed states; choose one consistent representation of absence at each boundary.

### [SANE-CORRECT-05] Make time and concurrency assumptions explicit

Protect against stale results, duplicate execution, lost updates, races, and re-entrancy. Bound queries, loops, recursion, retries, and external work; avoid N+1 behavior where it can change correctness or exhaust resources.

### [SANE-CORRECT-06] Make repetition safe

Retry only retryable operations. Use idempotency, deduplication, transactions, or compensation when repeated execution can duplicate an effect or corrupt state.

### [SANE-CORRECT-07] Fail closed on uncertainty

Unknown authorization, validation, integrity, configuration, parse, or external states must stop the operation or use an intentionally safe fallback. Never treat timeout or incomplete work as success.

### [SANE-CORRECT-08] Classify errors through typed boundaries

Use stable error types, codes, statuses, or result values. Never branch on human-readable message text. Error contracts should tell callers whether to retry, correct input, reauthenticate, or escalate.

### [SANE-CORRECT-09] Clean up and cancel correctly

Cancellation and timeout must release resources and prevent late results from mutating newer state. Every acquired resource has an obvious owner and cleanup path.

### [SANE-CORRECT-10] Keep code and configuration honest

Delete unused variables, functions, imports, and exports rather than hiding them. Comments explain non-obvious constraints, not code that should be simplified. Treat configuration changes as behavior changes and review them explicitly.

## Authoring checklist

List boundary and edge inputs, mutations, retries, concurrency, cancellation, precision/timezone assumptions, and recovery behavior. Verify each with tests or documented evidence.