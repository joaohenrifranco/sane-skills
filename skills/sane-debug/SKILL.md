---
name: sane-debug
version: 3.0.0
description: |
  Evidence-led debugging for bugs and errors. Isolates the originating cause,
  fixes the responsible boundary with the smallest justified change, and verifies
  behavior without mandatory ritual or speculative patches.
---

# /sane-debug — Evidence-Led Root-Cause Investigation

## Operating position

Debug from observed behavior toward the boundary that first permits invalid state or
behavior. Prefer the cheapest evidence that can distinguish live hypotheses, and stop
tracing once cause, ownership, and consequence are established. Reproduction is
valuable but not mandatory when logs, state, tests, traces, or code establish the
same facts.

Reject guess-and-patch debugging, stacked defensive changes, broad refactors during
an investigation, and claims stronger than the evidence. Retries, catches, defaults,
validation, and extra logging are not root-cause fixes unless the responsible boundary
actually owns that failure semantics. When production code changes, follow repository
guidance and the applicable `sane-code` rules.

## Rules

### [SANE-DEBUG-EVIDENCE-FIRST] Gather evidence from reproduction, logs, traces, metrics, database state, or code inspection

Start with the symptom, expected behavior, conditions, timing, and trustworthy
artifacts already available. Use reproduction, logs, traces, metrics, database state,
recent changes, or code inspection according to information value and cost. Prefer
read-only and local evidence first; request production access, new telemetry, or user
data only when safer evidence cannot answer the question, and account for privacy and
operational risk.

### [SANE-DEBUG-TRACE-FAILING-PATH] Trace the complete failing path

Trace enough of the path to connect the trigger to the failure and identify where the
relevant invariant stops holding. Include callers, branches, async boundaries,
persistence, and error handling only where they can alter the outcome. Do not map the
entire system by default. Expand outward when ownership is unclear, evidence conflicts,
or work can repeat, overlap, arrive late, or complete partially.

### [SANE-DEBUG-ORIGINATING-CAUSE] Find the originating cause, not only the visible symptom

Locate the earliest responsible boundary that admits or creates the bad behavior and
explain why its contract allowed it. Distinguish root cause from trigger, propagation,
and detection site. A local guard is sufficient when that boundary owns the invariant;
it is only symptom masking when another owner can continue producing invalid state.
Recurring cross-boundary failures may justify a design change, but one incident alone
does not mandate a new abstraction.

### [SANE-DEBUG-FALSIFIABLE-HYPOTHESES] Test a specific hypothesis and revise when evidence disagrees

State a falsifiable hypothesis and the observation that would support or refute it.
Run the smallest useful check, update confidence explicitly, and discard explanations
that conflict with evidence. Parallel hypotheses are acceptable when checks are cheap
or the incident is urgent; do not turn uncertainty into multiple speculative fixes.

### [SANE-DEBUG-EVIDENCE-BASED-ESCALATION] Escalate after repeated unsupported hypotheses

Escalate based on risk and missing information, not a fixed hypothesis count. Add
targeted instrumentation, isolate a smaller reproducer, consult the owning team, or
pause changes when the next check requires unavailable access, unsafe production
experimentation, specialist knowledge, or disproportionate cost. Continue locally
while each check is safe and materially narrows the cause.

### [SANE-DEBUG-MINIMAL-ROOT-FIX] Fix the root cause minimally

Change the boundary that owns the violated invariant with the smallest fix that makes
invalid behavior impossible or explicitly recoverable. Preserve unrelated behavior
and avoid opportunistic cleanup. For external or asynchronous work, use explicit
state, idempotency, durable progress, or reconciliation when evidence shows repeats,
overlap, delay, or partial completion are part of the cause; do not add distributed
machinery to a purely local failure.

A containment patch is acceptable when impact is active and the root fix is unsafe or
slow, but label it as containment, bound its lifetime or removal condition, and retain
a path to the owning fix.

### [SANE-DEBUG-BEFORE-AFTER-VERIFICATION] Verify before/after behavior and add regression coverage

Demonstrate that the evidence which exposed the bug changes as predicted and that the
relevant surrounding behavior remains intact. Run the narrowest meaningful automated
checks first and broaden only for plausible blast radius. Add regression coverage when
it can reproduce the contract or invariant reliably; prefer instrumentation or an
operational check when automation would be flaky, unsafe, or unable to represent the
failure. State what was not verified and why.

## Output contract

Return or post a concise report containing:

- **Evidence** — observed facts and decisive checks;
- **Root cause** — responsible boundary, violated invariant, and causal explanation;
- **Fix** — root-cause change, or clearly labeled containment, with rejected patching alternatives;
- **Verification** — before/after evidence and checks actually run;
- **Remaining risk** — uncertainty, missing evidence, or follow-up ownership.

Do not edit code until evidence supports the cause strongly enough that the proposed
change has a predicted effect. High-impact containment is the bounded exception and
must not be presented as a confirmed root-cause fix.
