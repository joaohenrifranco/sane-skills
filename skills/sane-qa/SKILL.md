---
name: sane-qa
version: 2.0.0
description: |
  Evidence-led browser QA for observable user contracts and changed risk. Use for
  branch/diff-aware verification, exploration of an explicit URL or flow, bug
  confirmation, regression checks, and ship-readiness evidence. Requested fixes
  are handed to sane-debug; routine QA does not modify or commit source code.
---

# sane-qa — Evidence-led browser QA

Test observable behavior, not implementation guesses. Start from the user's stated
intent, PR test plan, changed contracts, and credible failure modes. Spend effort in
proportion to consequence and uncertainty; broad activity is not evidence of quality.
Repository instructions and the most specific applicable `AGENTS.md` take precedence.

Use `sane-browse` for browser setup, commands, screenshots, state preservation, and
user handoff. Confirm that its `$B` runtime or an equivalent is available. If it is
not, ask for the host project's browser setup; do not guess installation commands,
frameworks, package managers, ports, credentials, or routes.

## Scope and depth

Choose the smallest depth that can produce useful evidence. Tiers control coverage,
never which findings get fixed:

- **Quick:** Exercise the highest-risk contract or critical happy path and one
  credible failure or boundary condition when applicable. Use for narrow changes,
  incident confirmation, or a smoke check.
- **Standard (default):** Exercise each changed or requested user contract, its
  important state transitions and failure behavior, plus adjacent behavior at real
  regression risk.
- **Exhaustive:** Add consequential role, state, data, viewport, integration, and
  recovery variations justified by the product and available environment. Exhaustive
  means risk coverage with evidence, not every page or control.

State what is in scope, what is excluded, and why. Do not promise universal page
counts, issue counts, or completion times.

## Exploration modes

### Branch/diff-aware

Use when validating repository changes, including when no URL was supplied.

1. Determine the current branch, merge base or explicit diff scope, PR metadata when
   available, changed files, applicable repository instructions, and environment or
   configuration implications. Do not assume the base branch is `main`.
2. Prefer the PR test plan and user-stated acceptance criteria. Use the diff, relevant
   callers/consumers, and existing tests to identify observable contracts and changed
   risk—not to infer a framework-specific checklist.
3. Map those contracts to reachable URLs, APIs, roles, data states, and prerequisites.
   If the target environment cannot be established from repository or PR context, ask
   for the URL or startup instructions rather than probing arbitrary ports.
4. Test the changed contracts first, then only adjacent flows with a plausible shared
   dependency or regression path. If a change has no browser-observable contract,
   report that limitation and run the most relevant existing validation instead of
   inventing browser coverage.

A supplied URL may be used as the environment while scope remains diff-aware.

### Explicit URL or flow

Use when the user supplies a URL or names a flow without requesting branch analysis.
Treat the URL, requested outcomes, available product documentation, and behavior
visible in the UI as the contract. Explore enough surrounding behavior to understand
preconditions and consequences, but do not turn a focused request into an automatic
full-application crawl. Ask for missing acceptance criteria when pass/fail cannot be
observed unambiguously.

If the user requests comparison or regression testing, compare the same contracts,
preconditions, data, and environment against supplied prior evidence. Report concrete
behavioral differences; do not convert them into synthetic health scores.

## Workflow

### 1. Define contracts and risks

For each behavior in scope, record:

- actor, preconditions, environment, and data state;
- action or trigger;
- expected observable result and prohibited result;
- consequence if it fails;
- evidence needed to decide pass, fail, or unverified.

Prioritize authorization and data exposure, irreversible side effects, money or
entitlement changes, state transitions, external integrations, recovery paths, and
high-use workflows when they are relevant. Do not manufacture checks merely to fill a
category.

### 2. Establish safe state

Do not require a clean tree, commit, stash, revert, or otherwise mutate repository
history. Note the tested revision and relevant uncommitted changes so the evidence can
be interpreted correctly.

Use accounts, sessions, and test data authorized by the user or environment. Never put
passwords, tokens, cookies, OTPs, or personal data in commands that will be reported,
screenshots, reports, or committed files. Prefer session import or interactive handoff;
use `sane-browse` handoff for MFA, CAPTCHA, OAuth, or other user-only steps. Do not
assume permissions or attempt privilege escalation.

Avoid purchases, deletes, invitations, outbound messages, production writes, account
or permission changes, and other irreversible or externally visible actions unless the
user explicitly authorized that exact class of action in a suitable environment. Use
sandbox/test modes, reversible substitutes, or stop before final confirmation. If
safety or reversibility is uncertain, ask before triggering the action. Never perform
destructive cleanup just to restore state.

### 3. Execute and observe

For each selected contract:

1. Establish and record the precondition.
2. Capture the relevant initial state when it helps explain the result.
3. Perform the minimum realistic user actions needed to exercise the contract.
4. Observe the user-visible result and relevant state change. Inspect console or
   network output when it can explain or contradict the observed behavior.
5. Check only risk-justified boundaries, failure states, roles, or viewports.

A console message, implementation detail, or visual difference is not automatically a
bug. Relate it to a violated observable contract or report it as non-blocking runtime
evidence with its uncertainty.

### 4. Confirm before reporting

Reproduce a suspected issue from a known state. Repeat the decisive path at least once
when safe and practical, and vary one relevant condition if that helps distinguish a
product defect from stale state, test data, environment failure, or timing. Do not
report an unconfirmed observation as a verified finding.

Classify the result as:

- **Pass:** the contract was observed under recorded conditions.
- **Confirmed issue:** the contract was violated reproducibly or by decisive evidence.
- **Intermittent:** repeated attempts differ; include attempt counts and conditions.
- **Blocked:** a prerequisite, environment, permission, or dependency prevented the
  test.
- **Unverified:** evidence is insufficient; state exactly what is missing.

Severity follows concrete user or business consequence and reachability, not cosmetic
labels or issue quotas.

### 5. Record reproducible evidence

Each confirmed or intermittent issue should include:

- concise title and impact-based severity;
- tested revision, environment, URL/route, actor, and data preconditions;
- minimal numbered reproduction steps;
- expected versus actual observable behavior;
- reproducibility or attempt count;
- focused evidence such as before/after screenshots, snapshot diff, response details,
  console/network excerpt, or timestamp—using only what proves the claim;
- known scope, uncertainty, and the smallest useful retest.

Store ephemeral screenshots and machine-readable evidence under `.local/` when useful
and keep secrets and unnecessary personal data out. After `sane-browse` creates a
screenshot, use the Read tool so it is visible to the user. Do not commit QA artifacts.

## Fix requests

Routine QA is read-only with respect to source code. Do not automatically fix, generate
regression tests, commit, revert, or widen scope. When the user explicitly requests a
fix, hand each confirmed issue to `sane-debug` with its contract, impact, reproduction,
environment, and evidence. `sane-debug` owns root-cause analysis and the minimal code
and test changes.

After a reported fix, rerun the original reproduction under equivalent conditions and
test only adjacent risks introduced by the fix. Report it as verified, still failing,
intermittent, blocked, or unverified. Never claim a fix from code inspection alone.

## Report and publishing

Report:

- mode, tier, target, revision/diff scope, environment, and tested actors;
- contracts exercised and evidence-backed result for each;
- confirmed and intermittent issues ordered by consequence;
- blocked or unverified checks and the missing prerequisites;
- validation commands or browser checks actually run;
- remaining risk and explicitly excluded scope.

When a PR exists, discover its metadata with the repository's GitHub tooling and post
one new machine-parseable QA comment; do not edit previous comments. Publish only
sanitized evidence and link or summarize `.local/` artifacts as the environment allows.
When no PR exists, return the report in the response or write it under `.local/` if a
persistent artifact is useful or requested. Never create QA reports in committed
project files.
