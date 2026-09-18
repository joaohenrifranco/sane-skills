# Test Rules

Portable guidance for tests that protect observable behavior and recovery paths.

### [SANE-TEST-01] Trace changed behavior end to end

Follow each changed entry point from input through transformations, effects, and output. Test behavior observable by users, callers, operators, or downstream systems, not only internal implementation paths.

### [SANE-TEST-02] Test contracts, not incidental implementation

Prefer assertions about outputs, state transitions, emitted effects, and supported errors. A contract-preserving refactor should not require rewriting unrelated tests.

### [SANE-TEST-03] Cover normal, boundary, and failure behavior

Consider representative valid input; empty, missing, minimum, maximum, and malformed input; dependency failures and timeouts; repeated or concurrent invocation; cancellation; partial completion; and recovery after errors.

### [SANE-TEST-04] Exercise every behaviorally meaningful branch

Cover guards, retries, authorization paths, fallbacks, error handlers, and state transitions that change behavior. If a branch is not tested, record why it is unreachable, covered elsewhere, generated, or accepted risk.

### [SANE-TEST-05] Add regression coverage for defects

A fixed defect gets a test that fails for the old behavior and passes for the corrected behavior, at the smallest boundary that reproduces the real condition.

### [SANE-TEST-06] Test recovery, cleanup, and cancellation

Verify visible output, persisted state, retries, cleanup, and whether work can safely continue after failure. An assertion that an exception was thrown is insufficient when recovery matters.

### [SANE-TEST-07] Use the lowest reliable test level

Use unit tests for deterministic logic, integration tests for boundaries, and end-to-end tests for critical multi-component workflows. Do not replace meaningful integration coverage with mocks that merely reproduce implementation assumptions.

### [SANE-TEST-08] Control nondeterminism

Control time, randomness, concurrency, network behavior, and external services with clocks, synchronization, injected dependencies, fixtures, or bounded polling. Avoid arbitrary sleeps and order-dependent tests.

### [SANE-TEST-09] Keep fixtures representative and minimal

Make important assumptions visible near the test. Avoid shared mutable fixtures and setup that hides the behavior under test.

### [SANE-TEST-10] Treat tests as behavior documentation

Names and assertions describe supported behavior and constraints. Changing or weakening an assertion is a behavior change requiring review, not a way to accommodate an implementation.

## Authoring checklist

Map changed codepaths to existing tests, add missing branch and recovery evidence, check mock boundaries, and confirm tests are deterministic and independently runnable.