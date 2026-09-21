# Test Rules

Opinionated defaults for tests that prove observable contracts, failure handling, and recovery without coupling to implementation.

### [SANE-TEST-OBSERVABLE-BOUNDARIES] Prove changed behavior at an observable boundary

Every behavior change must have a test that enters through the narrowest public boundary capable of demonstrating the result and observes the output, owned state, or effect promised by that boundary. Do not stop at a helper test when wiring, translation, or effect execution could still break the behavior. Pure refactors need no new case when existing contract tests already exercise the changed path.

### [SANE-TEST-CONTRACT-ASSERTIONS] Assert contracts, not implementation choreography

Assert returned outcomes, committed state, published effects, and stable failure semantics. Do not assert private calls, call order, internal data shapes, or incidental algorithms unless that interaction is itself the contract. A contract-preserving refactor should leave most tests unchanged, even when collaborators or control flow change.

### [SANE-TEST-BEHAVIOR-BOUNDARIES] Select cases from behavior boundaries

For each changed contract, test a representative success, the nearest input or state boundary where behavior changes, and every expected failure with a distinct caller remedy. Add overlap, repetition, timeout, cancellation, or partial-completion cases only when the operation can encounter them. Do not create a ceremonial matrix of values that all exercise the same decision.

### [SANE-TEST-DECISION-OUTCOMES] Exercise every meaningful decision outcome

Each guard, authorization decision, retry terminal state, fallback, and state transition that changes observable behavior requires direct evidence. Coverage percentages do not substitute for an assertion about the outcome. Leave a branch untested only when it is generated, unreachable by construction, or already proved at a more appropriate boundary, and make that reason explicit in review.

### [SANE-TEST-REGRESSION-COVERAGE] Make every defect fix a regression test

A defect fix must include a test that fails against the faulty behavior and passes with the fix, reproducing the real trigger at the smallest observable boundary. Do not encode the patch's internal shape as the assertion. Omit the test only when execution is impossible in the repository; record the missing harness and manual evidence instead.

### [SANE-TEST-INTERRUPTED-STATE] Prove the state left after interruption

When work can fail, retry, cancel, or complete partially, assert the final owned state, externally visible effects, released resources, and whether a later attempt can proceed safely. Merely asserting that an error was raised is insufficient. Test cleanup after both partial initialization and repeated cleanup when those paths are possible.

### [SANE-TEST-RISKY-BOUNDARY] Use the lowest level that includes the risky boundary

Test deterministic policy directly, but test serialization, persistence, transport, framework integration, and vendor adapters against their real boundary or a faithful local implementation. Do not mock the component whose contract is under test or replace integration evidence with expectations that restate production calls. Reserve end-to-end tests for critical workflows that cannot be proved by narrower boundary tests because their cost and diagnosis time are higher.

### [SANE-TEST-OWNED-NONDETERMINISM] Make nondeterminism test-owned

Tests must control outcome-affecting time, randomness, scheduling, and dependency responses through a test-owned boundary, and concurrent tests must synchronize on observable conditions. Fixed sleeps, live external services, and dependence on suite order are prohibited defaults. A real-time timeout test may use the actual clock only when timing is the contract and the assertion has a bounded, platform-tolerant margin.

### [SANE-TEST-LOCAL-FIXTURES] Keep fixtures local, valid, and minimal

Construct only the state relevant to the behavior and keep decisive values visible in the test. Fixtures must satisfy real invariants but must not import production snapshots, share mutable state, or hide important defaults behind broad setup. Shared immutable builders are acceptable when each test overrides the values that drive its outcome.

### [SANE-TEST-ASSERTIONS-AS-CONTRACT] Treat assertions as the executable behavior record

Name tests as supported behavior under a stated condition, and make each failure identify the broken contract. Do not weaken, delete, or bulk-update assertions merely to make a new implementation pass; review such changes as changes to supported behavior. Implementation-focused tests may document a deliberate algorithmic constraint only when that constraint is itself required.
