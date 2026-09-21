---
name: sane-benchmark
version: 5.0.0
description: |
  Evidence-based runtime performance measurement for live sites. Use when:
  "slow", "performance", "benchmark", "laggy", "page speed", "bundle size",
  "why is X slow", or "optimize".
---

# Runtime measurement (invoked as /sane-benchmark <url>)

Use the browser runtime supplied by `sane-browse` or the host environment.
Confirm that `$B` is available before measuring. If it is unavailable, request
the host project's setup instructions rather than assuming a tool, package
manager, or repository path.

This skill measures and narrows a runtime performance problem. It does not make
code changes. When measurements justify code investigation, hand one measured
bottleneck to `sane-debug`.

## Arguments

- `/sane-benchmark <url>` — measure, diagnose one bottleneck, and report
- `/sane-benchmark <url> --measure` — measure only and print the scorecard
- `/sane-benchmark <url> --baseline` — capture a comparison baseline
- `/sane-benchmark --diff` — remeasure explicitly identified branch-affected
  pages and compare them with a compatible baseline
- `/sane-benchmark <url> --focus <metric>` — constrain diagnosis to `fcp`,
  `bundle`, `ttfb`, or `network`

If `--diff` cannot determine affected pages from project evidence, ask for the
URLs. Do not invent route coverage from filenames alone.

## Measurement contract

Before running, define and report:

- target URL, build or revision, and environment;
- viewport and browser/runtime;
- authentication state and representative test data;
- cache state and whether the run is cold or warm;
- network/CPU shaping, if any;
- the workload and its completion condition;
- repetition count and aggregation method.

Use project performance budgets and production telemetry when available. They
take precedence over defaults in this skill.

If the user or project provides no protocol, use this **provisional default**:
a desktop viewport, the runtime's unthrottled local conditions, one warm-up run,
then three measured runs with the median as the comparison value and the full
range shown. This default improves repeatability but does not represent every
user device or network. Keep conditions identical for before/after comparisons.

A representative workload is the smallest real user journey that exhibits the
reported problem, including realistic data volume and an observable completion
condition. For a page-load report, measure navigation through meaningful content
readiness. For interaction lag, measure the named interaction rather than using
page load as a proxy. If no workload is supplied, state the chosen workload and
why available evidence makes it representative.

## Phase 1: Measure [SANE-BENCHMARK-MEASURE]

Create `.local/benchmark` if artifacts will be saved. For each measured run,
start from the declared cache/auth state and execute the same workload.

```bash
$B viewport <WxH>
$B goto <url>
$B perf
$B js "JSON.stringify(performance.getEntriesByType('navigation')[0])"
$B js "JSON.stringify(performance.getEntriesByType('paint'))"
$B js "JSON.stringify(performance.getEntriesByType('resource').map(r => ({name: r.name.split('/').pop().split('?')[0], url: r.name, type: r.initiatorType, size: r.transferSize, duration: Math.round(r.duration), start: Math.round(r.startTime)})).sort((a,b) => b.duration - a.duration))"
$B js "(() => { const r = performance.getEntriesByType('resource'); const byType = r.reduce((a,e) => { const t = e.initiatorType; a[t] = (a[t]||{count:0,bytes:0}); a[t].count++; a[t].bytes += e.transferSize||0; return a; }, {}); return JSON.stringify({total_requests: r.length, total_bytes: r.reduce((s,e) => s+(e.transferSize||0),0), by_type: byType}); })()"
```

`transferSize` may be zero for cached, cross-origin, or unavailable timing data;
do not describe it as bundle size without confirming what the entries include.
Separate JavaScript transfer from total transfer by filtering resource URLs or
initiator types using evidence appropriate to the application.

For long tasks during an interaction, install the observer **before** the
representative action, perform that action, wait for its declared completion
condition, and then read the result:

```bash
$B js "(() => { window.__lt = []; window.__ltObs?.disconnect(); window.__ltObs = new PerformanceObserver(l => window.__lt.push(...l.getEntries())); window.__ltObs.observe({ type: 'longtask', buffered: true }); return 'longtask observer registered'; })()"
# Perform the representative interaction here.
$B js "JSON.stringify({ count: window.__lt.length, total_block_ms: Math.round(window.__lt.reduce((s,e) => s+e.duration,0)), longest_ms: Math.round(Math.max(0,...window.__lt.map(e => e.duration))) })"
```

This observer measures only the interval in which it is active. Do not present it
as initial-load coverage when it was registered after navigation. If the runtime
does not expose an entry or metric, report it as unavailable rather than
estimating it.

### Scorecard

```text
PERFORMANCE SCORECARD — [url]
Context: [build, environment, viewport, cache, shaping, auth/data]
Workload: [start → action → completion condition]
Runs: [count; aggregation; range]
══════════════════════════════════════════════════════════════
TTFB                 [median; range; unit]
FCP                  [median; range; unit]
Navigation/load      [median; range; unit]
JavaScript transfer  [median; range; unit; inclusion rule]
Total transfer       [median; range; unit]
Long tasks           [median count/total/longest; measured interval]

COMPARISON:
  Baseline/current delta: [absolute and percentage, if compatible]
  Project budget: [pass/fail/not provided]

EVIDENCE FOR DIAGNOSIS:
  [resource, request, timing, or task directly relevant to the chosen bottleneck]
```

Report raw values before labels. Use `GOOD`, `SLOW`, `CRITICAL`, `BLOATED`, or a
pass/fail result only when a project budget, SLO, product requirement, or cited
external standard defines that label for this workload. If the team asks for a
triage threshold and none exists, propose it explicitly as a provisional local
default and do not present it as a universal performance boundary.

If `--measure` is set, stop here.

## Phase 2: Diagnose [SANE-BENCHMARK-DIAGNOSE]

Choose exactly one bottleneck supported by the scorecard or by `--focus`:

- TTFB: navigation timing shows time concentrated before the response begins.
- Render start/FCP: paint is late and the request/render evidence identifies a
  blocking dependency or main-thread interval.
- JavaScript transfer: confirmed JavaScript resources dominate the relevant
  transfer or loading interval.
- Long task: the representative interaction records main-thread blocking in the
  measured interval.
- Network waterfall: dependent or serialized requests delay the workload's
  completion condition.

Do not map a metric directly to a generic fix. For example, a large transfer does
not by itself prove code splitting is appropriate, and a long task does not by
itself prove memoization or virtualization is the remedy. If no single
bottleneck is supported, report that the measurement is inconclusive and name
the next discriminating measurement.

## Phase 3: Interpret [SANE-BENCHMARK-INTERPRET]

For the selected bottleneck, record:

1. the observation;
2. the measurement context and run-to-run variation;
3. the evidence connecting it to the representative workload;
4. plausible ownership boundaries to investigate, labeled as hypotheses;
5. missing evidence that could overturn the conclusion.

Do not infer a code root cause from one timing, blame infrastructure or a third
party without evidence, or broaden the report into a generic optimization
wishlist.

## Phase 4: Validate a fix [SANE-BENCHMARK-FIX-HANDOFF]

If code investigation is warranted, hand the following bounded packet to
`sane-debug`:

- one bottleneck and affected workload;
- raw measurements and artifact paths;
- exact reproduction context and commands;
- evidence supporting the bottleneck;
- hypotheses and known unknowns;
- the metric and completion condition to remeasure.

`sane-debug` owns root-cause analysis and the minimal code fix. Do not prescribe
an implementation from benchmark data alone. Change and evaluate one causal
factor at a time.

## Phase 5: Verify [SANE-BENCHMARK-VERIFY]

Repeat the Phase 1 protocol under compatible conditions and the same workload.
Do not reduce the run count or switch cache, viewport, data, shaping, or
completion conditions between before and after.

```bash
$B viewport <WxH>
$B goto <url>
$B perf
```

Print the before/after absolute delta, percentage delta, run ranges, and project
budget result when one exists. Call an improvement or regression only when the
difference is larger than observed measurement noise or crosses an applicable
budget. Otherwise report the result as inconclusive. Do not use a universal
percentage cutoff.

## Baseline / Diff

`--baseline` saves the scorecard values and full measurement contract to
`.local/benchmark/baseline.json`. A baseline without context is not reusable.

`--diff` compares only explicitly identified affected pages with baseline entries
whose workload, environment, viewport, cache, shaping, authentication/data, and
metric definitions are compatible. Report incompatible or missing baselines
instead of calculating a misleading delta. Apply project-defined regression
budgets; if none exist, report deltas and noise without inventing pass/fail
labels.

## Rules

- Evidence precedes diagnosis; validation repeats the measurement contract.
- Preserve raw results, context, workload, and variability with every summary.
- Measure a representative workload, not a convenient synthetic substitute.
- Diagnose one supported bottleneck and keep hypotheses distinct from facts.
- Do not modify production systems or production data during measurement.
- Hand code root-cause work and fixes to `sane-debug`.
