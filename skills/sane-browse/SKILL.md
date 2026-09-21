---
name: sane-browse
version: 2.0.0
description: |
  Browser evidence collection for live pages: navigate, inspect, interact,
  capture screenshots, and verify observable outcomes. Use when a task needs
  browser evidence. For systematic QA coverage, use /sane-qa instead.
---

# sane-browse — Browser Evidence

Use the headless browser runtime supplied by the host project or environment.
This skill assumes that `$B` invokes the bundled browser CLI, or a compatible
command with the semantics documented below. Preserve browser state between
calls when the runtime supports it.

## Setup and scope

Before browsing, confirm that `$B` is available. If it is unavailable, ask for
the host project's browser setup instructions; do not assume an installation
command, package manager, or repository path.

Start from the user's claim or a concrete behavior to verify. Default to the
smallest flow that can produce decisive evidence: one page, one action, one
observable outcome. Expand only when the result identifies another necessary
step. Do not turn a focused check into a generic site audit; use `sane-qa` when
systematic coverage is requested.

Record the target URL and relevant context such as viewport, authentication
state, and test data. Never report a browser state, error, or successful outcome
that was not observed.

## Evidence workflow

### 1. Orient

```bash
$B goto <url>
$B url
$B snapshot -i
```

Use the snapshot to identify actual controls before interacting. `snapshot -i`
returns interactive elements with `@e` references in tree order. References may
be used anywhere a selector is accepted:

```bash
$B click @e3
$B fill @e4 "value"
$B hover @e5
```

References are invalidated by navigation. Take a new snapshot after `goto`, a
link transition, form submission, or any action that substantially replaces the
page.

If an expected control is absent from the accessibility tree, use
`$B snapshot -C`. It adds cursor/handler/tabindex-discovered controls as separate
`@c` references. Use this as evidence of the rendered page, not as proof that the
control is accessible.

### 2. Establish a baseline and perform one action

```bash
$B snapshot
$B click @e3
$B wait --networkidle
$B snapshot -D
```

`wait` accepts a selector, `--networkidle`, or `--load`. Choose the condition
that corresponds to the expected outcome; network idle is not a universal
readiness signal.

`snapshot -D` produces a unified diff against the previous snapshot. Its first
use without a prior snapshot only stores a baseline. Prefer a specific state
check when the outcome has a stable selector:

```bash
$B is visible ".success-message"
$B is enabled "#submit"
$B js "document.body.textContent.includes('Saved')"
```

Supported `is` properties are `visible`, `hidden`, `enabled`, `disabled`,
`checked`, `editable`, and `focused`.

### 3. Collect corroborating evidence

Use only the evidence relevant to the claim:

```bash
$B console --errors
$B network
$B text
$B attrs <selector-or-ref>
$B css <selector-or-ref> <property>
```

`console --errors` filters to errors and warnings. `network` reports captured
requests; `network --clear` and `console --clear` reset their buffers before a
reproduction when old entries would be ambiguous. `$B perf` reports page-load
timings, but performance conclusions requiring controlled repetitions belong in
`sane-benchmark`.

For visual evidence:

```bash
$B screenshot .local/bug.png
$B snapshot -i -a -o .local/annotated.png
$B viewport 375x812
$B screenshot .local/mobile.png
```

`screenshot` saves a page or element image. `snapshot -a` creates a labeled
screenshot; `-o` sets its path and only applies with `-a`. After creating an
image, use the host's file-reading tool on the PNG so it is visible to the user.
A screenshot shows appearance, not causality; pair it with state, console, or
network evidence when making a causal claim.

### 4. Report what was observed

Report:

- the URL and relevant context;
- the exact action performed;
- the observed result and supporting command output or artifact path;
- whether the original claim was reproduced, contradicted, or remains
  unresolved;
- any untested boundary that materially limits the conclusion.

Separate observation from inference. If the evidence is insufficient, say what
single next observation would discriminate between the remaining explanations.

## Snapshot semantics

```text
-i        --interactive           interactive elements only, with @e refs
-c        --compact               omit empty structural nodes
-d <N>    --depth                 limit tree depth (0 is root only)
-s <sel>  --selector              scope to a CSS selector
-D        --diff                  diff against the previous snapshot
-a        --annotate              screenshot with ref labels
-o <path> --output                annotated screenshot path; requires -a
-C        --cursor-interactive    add non-ARIA clickable elements as @c refs
```

Flags may be combined, for example:

```bash
$B snapshot -i -a -C -o .local/annotated.png
```

`@e` and `@c` numbering are independent. Snapshot output is an indented
accessibility tree, not a DOM dump. Use `$B html [selector]` only when markup is
needed; without a selector it returns the full page HTML.

## Essential command semantics

- Navigation: `goto <url>`, `back`, `forward`, `reload`, `url`.
- Interaction: `click <selector>`, `fill <selector> <value>`,
  `select <selector> <value>`, `hover <selector>`, `press <key>`,
  `scroll [selector]`, `upload <selector> <file> [file2...]`.
- Waiting: `wait <selector|--networkidle|--load>`.
- Reading: `snapshot [flags]`, `text`, `html [selector]`, `links`, `forms`.
- Inspection: `is <property> <selector>`, `attrs <selector>`,
  `css <selector> <property>`, `js <expression>`, `console [--clear|--errors]`,
  `network [--clear]`, `dialog [--clear]`, `perf`.
- Visual: `screenshot [--viewport] [--clip x,y,w,h] [selector|@ref] [path]`,
  `responsive [prefix]`, `diff <url1> <url2>`.
- Dialogs: run `dialog-accept [text]` or `dialog-dismiss` before the action that
  opens the next dialog; inspect captured messages with `dialog`.
- Tabs: `newtab [url]`, `tabs`, `tab <id>`, `closetab [id]`.

`responsive [prefix]` captures the CLI's mobile, tablet, and desktop viewports
and writes `{prefix}-mobile.png`, `{prefix}-tablet.png`, and
`{prefix}-desktop.png`. `diff <url1> <url2>` is a text diff, not a pixel diff.

Use authentication, cookie, header, storage, user-agent, JavaScript, or server
commands only when required by the specific flow. Consult `$B` help rather than
preemptively exercising unrelated capabilities.

## User handoff

Hand off when progress requires a human-only step such as CAPTCHA, MFA, or an
OAuth approval, or when repeated automated interaction cannot safely establish
the required state.

```bash
$B handoff "CAPTCHA blocks login"
# Tell the user exactly what to complete and wait for confirmation.
$B resume
```

`handoff [message]` opens a visible browser at the current state. The runtime
preserves cookies, local storage, and tabs. `resume` returns control and takes a
fresh snapshot. Re-orient from that snapshot before continuing; do not assume
what the user changed.
