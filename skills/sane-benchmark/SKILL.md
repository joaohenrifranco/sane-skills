---
name: sane-benchmark
version: 4.0.0
description: |
  Runtime performance measurement workflow for live sites. Use when: "slow",
  "performance", "benchmark", "laggy", "page speed", "bundle size", "why is X slow",
  "optimize".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Runtime measurement (invoked as /sane-benchmark <url>)

Browser-based. Use the browser runtime supplied by `sane-browse` or the host
environment. Confirm that `$B` is available before measuring; if it is not,
request the host project's setup instructions rather than assuming a tool,
package manager, or repository path.

## Arguments
- `/sane-benchmark <url>` — measure and report runtime performance
- `/sane-benchmark <url> --measure` — measure only, print scorecard
- `/sane-benchmark <url> --baseline` — capture baseline for future comparisons
- `/sane-benchmark --diff` — measure pages touched by this branch, compare to baseline
- `/sane-benchmark <url> --focus <metric>` — diagnose a specific metric: `lcp`, `fcp`, `bundle`, `ttfb`, `renders`, `network`

## Phase 1: Measure [SANE-BENCHMARK-STEP-01]

```bash
mkdir -p ".local/benchmark"
$B goto <url>
$B perf
$B eval "JSON.stringify(performance.getEntriesByType('navigation')[0])"
$B eval "JSON.stringify(performance.getEntriesByType('paint'))"
$B eval "JSON.stringify(performance.getEntriesByType('resource').map(r => ({name: r.name.split('/').pop().split('?')[0], url: r.name, type: r.initiatorType, size: r.transferSize, duration: Math.round(r.duration), start: Math.round(r.startTime)})).sort((a,b) => b.duration - a.duration))"
$B eval "(() => { const r = performance.getEntriesByType('resource'); const byType = r.reduce((a,e) => { const t = e.initiatorType; a[t] = (a[t]||{count:0,bytes:0}); a[t].count++; a[t].bytes += e.transferSize||0; return a; }, {}); return JSON.stringify({total_requests: r.length, total_bytes: r.reduce((s,e) => s+(e.transferSize||0),0), by_type: byType}); })()"
$B eval "(() => { const lt = performance.getEntriesByType('longtask'); return JSON.stringify({count: lt.length, total_block_ms: Math.round(lt.reduce((s,e) => s+e.duration,0)), longest_ms: Math.round(Math.max(0,...lt.map(e => e.duration)))}); })()"
```

### Scorecard

```
PERFORMANCE SCORECARD — [url]
══════════════════════════════
TTFB            [X]ms    GOOD/SLOW/CRITICAL
FCP             [X]ms    GOOD/SLOW/CRITICAL
Full Load       [X]ms    GOOD/SLOW/CRITICAL
JS Bundle       [X]KB    GOOD/LARGE/BLOATED
Total Transfer  [X]KB    GOOD/LARGE/BLOATED
Long Tasks      [N]      NONE/SOME/MANY

WORST OFFENDERS:
  [1] <resource> — [Xms / XKB]
  [2] <resource> — [Xms / XKB]
  [3] <resource> — [Xms / XKB]
```

Thresholds: TTFB <200ms=GOOD, >500ms=CRITICAL. FCP <1000ms=GOOD, >2000ms=CRITICAL. Full Load <2000ms=GOOD, >4000ms=CRITICAL. JS Bundle <300KB=GOOD, >600KB=BLOATED. Total Transfer <1MB=GOOD, >3MB=BLOATED. Long Tasks: 0=NONE, 1–4=SOME, ≥5=MANY.

If `--measure`: stop here.

## Phase 2: Diagnose [SANE-BENCHMARK-STEP-02]

Pick the worst bottleneck. Categories: A (TTFB → backend), B (FCP slow → render-blocking), C (bundle bloated → code split), D (long tasks → memoize/virtualize), E (waterfall → parallelize).

## Phase 3: Interpret [SANE-BENCHMARK-STEP-03]

Identify the likely bottleneck and record the evidence needed for a root-cause
investigation. Do not infer a code fix from a single measurement.

## Phase 4: Validate a fix [SANE-BENCHMARK-STEP-04]

If a code change is needed, hand the measured bottleneck to `sane-debug` for
root-cause analysis and a minimal fix. Re-measure one change at a time.

## Phase 5: Verify

```bash
$B goto <url>
$B perf
```

Print before/after delta. If improvement <10%, the fix may not have addressed root cause.

## Baseline / Diff

`--baseline`: save metrics to `.local/benchmark/baseline.json`. `--diff`: measure branch-touched pages against baseline. Flag regressions >20%.

## Rules

- Measure before drawing conclusions; validate after every change.
- Investigate one bottleneck at a time and preserve the measurement context.
- Do not speculate about third-party or infrastructure causes; record them as
  dependencies for the host project to investigate.
- Do not modify production systems or data as part of measurement.
