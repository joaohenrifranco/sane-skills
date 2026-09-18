---
name: sane-debug
version: 2.1.0
description: |
  Systematic debugging guidance: gather evidence, trace the path, identify the
  root cause, make the smallest fix, and verify it. Use for bugs and errors.
---

# /sane-debug — Root-Cause Investigation

## Rules

### [SANE-DEBUG-01] Gather evidence from reproduction, logs, traces, metrics, database state, or code inspection
Use whatever evidence is available: reproduction, logs, traces, screenshots, metrics, database state, recent changes, or code inspection. Reproduction is useful but not required.

### [SANE-DEBUG-02] Trace the complete failing path
Follow the input from the triggering action through callers, branches, async boundaries, persistence, and error handling to the observed failure.

### [SANE-DEBUG-03] Find the originating cause, not only the visible symptom
Explain why the bad state was possible, not only where it became visible. Recurring failures in the same boundary may indicate an architectural defect.

### [SANE-DEBUG-04] Test a specific hypothesis and revise when evidence disagrees
Predict what the evidence should show, check it, and revise when it does not. Do not guess or stack unverified fixes.

### [SANE-DEBUG-05] Escalate after repeated unsupported hypotheses
After three unsupported hypotheses, escalate, add targeted instrumentation, or ask for evidence from someone who owns the system.

### [SANE-DEBUG-06] Fix the root cause minimally
Change only the boundary that creates the invalid behavior. Avoid unrelated refactors and defensive patches.

### [SANE-DEBUG-07] Verify before/after behavior and add regression coverage
Compare before and after behavior, run the narrowest relevant tests, and add a regression test when the failure was not already covered.

## Steps

1. Record the observed symptom and available evidence.
2. Map the failing codepath and recent changes.
3. State a testable root-cause hypothesis.
4. Verify it with the smallest useful check.
5. Implement the minimal root-cause fix.
6. Run regression validation and document remaining uncertainty.

## Output

For a PR, post a concise comment containing Evidence, Root Cause, Fix, Verification, and Remaining Risk. Do not edit code unless the investigation has confirmed the cause.
