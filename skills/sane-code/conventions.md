# Shared conventions

Used by `sane-code` review, `sane-qa`, `sane-benchmark`, and `sane-debug`. A workflow
that reports findings, posts to a PR, or hands work to another workflow follows these
definitions instead of inventing its own.

## Severity

Severity follows concrete consequence and reachability, not the category of the
rule or a cosmetic label.

- `critical`: a realistic trigger causes data loss or corruption, a security
  exposure, a broken public contract, an invariant violation, or a regression in a
  primary user workflow. Blocks merge or ship.
- `warning`: a real defect or risk with limited reach, a likely future failure, or
  a missing proof for changed behavior. Fix it, or the owner accepts it explicitly.
- `info`: an optional improvement, or a note with no demonstrated consequence.

A change is **blocking** when it has any `critical` finding, or a `warning` the owner
has not fixed or explicitly accepted. Never raise severity to fill a quota, and
state the evidence level: verified by execution, verified by inspection, or
uncertain.

`sane-qa` maps the user or business consequence of a confirmed issue onto the same
three levels. `sane-benchmark` reports measurements, not severities, unless a
project budget defines a threshold.

## PR comment envelope

When a PR exists and the host provides the tooling, post one new comment and never
edit an earlier one. The comment starts with a marker line, then a fenced `json`
block, then a short human summary:

````text
<!-- sane:<skill>:v1 -->
```json
{
  "skill": "sane-code",
  "scope": "<merge base>..<head>",
  "categories": ["correctness", "tests"],
  "findings": [
    {
      "severity": "warning",
      "rule": "SANE-CORRECT-AT-LEAST-ONCE",
      "file": "path/to/file",
      "line": 42,
      "consequence": "what breaks, observably",
      "remedy": "smallest appropriate fix",
      "evidence": "inspection"
    }
  ],
  "validation": ["commands or checks actually run"],
  "remaining_risk": ["what was not verified"]
}
```
Summary: blocking findings first, then warnings, then info.
````

`sane-qa` findings use `route` (URL or screen) and `steps` in place of `file` and
`line`. Publish only sanitized evidence.

## Handoff packet to `sane-debug`

A workflow that finds a defect or a measured bottleneck and has been asked to hand
off the fix gives `sane-debug` one bounded packet:

- the violated contract or the single bottleneck, and the affected workload;
- expected versus observed behavior, with severity from this file;
- the tested revision and environment, and the minimal reproduction;
- the evidence collected, with artifact paths;
- hypotheses, clearly labeled, and the known unknowns;
- the exact check to rerun after the fix, and its completion condition.

`sane-debug` treats the packet as a symptom report. It still gathers its own
evidence before it edits code.
