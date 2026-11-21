---
name: sane-browse
version: 3.0.0
description: |
  Browser evidence collection for live pages: navigate, inspect, interact,
  capture screenshots, and verify observable outcomes, headless or headed.
  Hands off to the user for CAPTCHAs, MFA and logins, and keeps sessions in
  a per-project profile. Use when a task needs browser evidence. For systematic QA
  coverage, use /sane-qa instead.
---

# sane-browse — Browser Evidence

## Setup

`$B` is the launcher inside this skill: `<this skill's directory>/browse/bin/browse`.

```bash
B="<this skill's directory>/browse/bin/browse"
$B doctor          # checks bun, Chromium, profile, cookie sources
```

The first call installs dependencies and Chromium by itself (one time,
~150MB). It needs [Bun](https://bun.sh); without it the launcher prints the
one install command and exits 2. `$B doctor --fix` retries the Chromium
download. Nothing is written into the repository: state, logs and the
browser profile live under `~/.cache/sane-browse` (override with
`BROWSE_HOME`), and default screenshots go to the system temp directory.

Each project gets one browser server and one persistent profile, so
cookies and logins survive restarts. Calls from the same project share it.

## Scope

Start from the user's claim or a concrete behavior to verify. Default to the
smallest flow that can produce decisive evidence: one page, one action, one
observable outcome. Expand only when the result identifies another necessary
step. Do not turn a focused check into a generic site audit; use `sane-qa`
when systematic coverage is requested.

Record the target URL and relevant context such as viewport, authentication
state, and test data. Never report a browser state, error, or successful
outcome that was not observed.

## Choosing a mode

| Situation | Use |
|---|---|
| Default evidence collection, CI | headless (no flag) |
| The user wants to watch, or headless behaves differently | `$B --headed goto <url>` |
| CAPTCHA, MFA, OAuth consent, a login the agent must not type | `$B handoff "<what to do>" --until <condition>` |
| The task needs a signed-in session | `handoff` so the user signs in once; the profile keeps it |
| The user explicitly asks to reuse their own browser's login | last resort: `cookies import ... --unsafe-copy-browser-cookies` (see below) |
| A clean, reproducible run with no saved state | `$B --ephemeral ...` |
| Parallel agents on one project | `--session <name>` per agent |

Launch options (`--headed`, `--profile`, `--ephemeral`, `--proxy`) apply when
the browser starts. If a browser is already running with different options,
the call exits 2 and says so; run `$B stop` first.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | ok | continue |
| 1 | failed: the page or browser did not cooperate | read the message and hint; observe before retrying |
| 2 | usage: bad arguments, path or conflicting options | fix the call |
| 3 | needs the user: CAPTCHA, login, Keychain or privacy dialog | tell the user exactly what to do; wait |

Add `--json` to get `{"ok":true,"output":...}` or `{"ok":false,"code":...,"error":...,"hint":...}`.

## Evidence workflow

### 1. Orient

```bash
$B goto <url>
$B snapshot -i
```

`snapshot -i` lists interactive elements with `@e` refs in tree order. Refs
work anywhere a selector is accepted (`click @e3`, `fill @e4 "value"`) and
are invalidated by navigation; take a new snapshot after `goto`, a link
transition, a form submission, or any action that replaces the page.

If an expected control is missing, check the end of the snapshot: iframes
are listed there and their content is not in the tree. Enter one with
`$B frame --name <name>` (or `--url <part>`, or a selector), snapshot again,
and return with `$B frame main`. `$B snapshot -C` adds cursor/onclick
elements as `@c` refs; that is evidence of the rendered page, not proof the
control is accessible.

### 2. Establish a baseline and perform one action

```bash
$B snapshot
$B click @e3
$B wait --networkidle
$B snapshot -D
```

`wait` accepts a selector or ref, `--networkidle`, `--load` or
`--domcontentloaded`, and an optional timeout in ms (default 15000). Choose
the condition that matches the expected outcome; network idle is not a
universal readiness signal. `snapshot -D` diffs against the previous
snapshot of the same tab; the first use only stores a baseline. Prefer a
specific state check when the outcome has a stable selector:

```bash
$B is visible ".success-message"
$B js "document.body.innerText.includes('Saved')"
```

`is` supports `visible`, `hidden`, `enabled`, `disabled`, `checked`,
`editable` and `focused`.

### 3. Collect corroborating evidence

```bash
$B console --errors
$B network
$B text
$B attrs <selector-or-ref>
$B css <selector-or-ref> <property>
```

`console --clear` and `network --clear` reset the buffers before a
reproduction. `perf` reports load timings; controlled performance claims
belong in `sane-benchmark`.

```bash
$B screenshot .local/bug.png                 # relative to your cwd
$B screenshot --selector "#cart" --out .local/cart.png
$B snapshot -i -a -o .local/annotated.png    # labeled refs
$B device "iPhone 15" && $B reload && $B screenshot .local/mobile.png
```

Output paths must be inside the project, the current directory, the temp
directory or `~/.cache/sane-browse`; parent folders are created. Open the
PNG with the host's file-reading tool so the user sees it. A screenshot
shows appearance, not causality; pair it with state, console or network
evidence for causal claims.

### 4. Report what was observed

Report:

- the URL and relevant context (mode, viewport/device, signed-in state);
- the exact action performed;
- the observed result and supporting output or artifact path;
- whether the claim was reproduced, contradicted, or remains unresolved;
- any untested boundary that materially limits the conclusion.

Separate observation from inference. If the evidence is insufficient, say
what single next observation would discriminate between the explanations.

## User handoff

Hand off when progress needs a human: CAPTCHA, MFA, an OAuth approval, a
password the agent must not type, or after repeated failures that look like
a bot wall (the CLI hints at this after three page failures).

```bash
$B handoff "Solve the CAPTCHA, then continue to the dashboard" --until url:/dashboard
```

The browser reopens visibly on the same profile and tabs; tell the user
exactly what to do. `--until` blocks until the condition holds, then
returns to headless and prints a fresh snapshot:

- `url:<text>` or `url:/<regex>/` — any tab's URL matches;
- `selector:<css>` — the element is visible in the active tab;
- `closed` — the user closes the window.

The default wait is 10 minutes; change it with `--timeout <ms>`. On timeout
the call exits 3 and the window stays open; ask the user, then `$B resume`.
Without `--until`, `handoff` returns at once and `$B resume` ends it.
`--stay-headed` keeps the window after resuming.

Cookies, localStorage and sessionStorage carry over in both directions.
Back/forward history and unsaved in-page state do not, and a tab reached by
a form POST reloads as GET (the output warns). Re-orient from the resume
snapshot; do not assume what the user changed. Never ask the user to share
a password or code with you instead.

## Sessions and cookies

The default profile keeps cookies, including session cookies, across
restarts, in `~/.cache/sane-browse/profiles/<project>` (never the repo). To
get a signed-in session, hand off and let the user sign in once:

```bash
$B handoff "Sign in to example.com" --until url:/dashboard
$B cookies --domain example.com          # list; values redacted
$B cookies clear --domain example.com
$B state save before-test                # cookies + localStorage, 0600
$B state load before-test
$B purge --yes                           # delete this project's profile, cookies, logs, states
```

### Copying the user's browser cookies (unsafe, last resort)

Copying cookies out of the user's Chrome, Brave, Edge, Arc or Firefox hands
the agent their real, signed-in sessions. It is off by default. Use it only
when the user explicitly asks for it, never as a way around a login wall,
and only for the domains the task needs:

```bash
$B cookies sources
$B cookies import chrome --domain example.com --unsafe-copy-browser-cookies --verify-auth "[data-user-menu]"
$B cookies clear --imported              # remove the copies now
```

- Without `--unsafe-copy-browser-cookies` the command exits 2 and suggests
  handoff. The same flag is required for `cookies picker`.
- Copies are temporary: they are removed when the browser stops, or at the
  next start after a crash. `--persist` keeps them in the project profile
  until they expire; remove them with `cookies clear` or `purge`. In an
  `--ephemeral` browser they only ever exist in memory.
- `--domain` covers the domain, its dotted form and its subdomains. When
  several profiles have cookies the command exits 2 and lists the exact
  command for each; let the user choose.
- Exit 3 means the user must act: allow the macOS Keychain prompt, or give
  the terminal Full Disk Access when macOS privacy protection blocks the
  browser's data folder.
- Copying does not prove sign-in. `--verify-auth <selector>[=<text>]`
  reloads the site and checks an element only a signed-in user sees. Some
  sites (Google, for example) reject sessions copied from another browser;
  then use handoff.
- Never print, log or report cookie values (`cookies --values` exists for
  debugging only).

Supported: Chrome, Chromium, Brave, Edge, Arc and Comet on macOS; Firefox
on macOS, Linux and Windows. Chromium cookies on Linux and Windows
App-Bound Encryption are not readable.

## Snapshot flags

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

Snapshot output is an indented accessibility tree, not a DOM dump. Use
`$B html [selector]` only when markup is needed.

## Command reference

Run `$B help` for the full list with usage. In short:

- Navigation: `goto`, `back`, `forward`, `reload`, `url`.
- Interaction: `click`, `fill`, `select`, `hover`, `type`, `press`,
  `scroll`, `upload <sel> <file...>`, `wait`, `viewport <WxH>`.
- Reading: `snapshot`, `text`, `html`, `links`, `forms`, `accessibility`.
- Inspection: `is`, `attrs`, `css`, `js <expr>`, `eval <file>`, `console`,
  `network`, `dialog`, `storage`, `perf`.
- Frames: `frame <sel|@ref|--name n|--url part|main>`.
- Visual: `screenshot`, `pdf`, `responsive [prefix]`, `diff <url1> <url2>`
  (text diff), `download <url|sel> [--out path]`.
- Mobile: `device <name> [--landscape] | off | --list`, `tap`, `swipe`.
- Dialogs: run `dialog-accept [text]` or `dialog-dismiss` before the action
  that opens the dialog; `dialog` shows what was captured. Dialogs never
  block the browser.
- Tabs: `newtab [url]`, `tabs`, `tab <id>`, `closetab [id]`.
- Multi-step: `chain` reads `[["cmd","arg"],...]` from stdin and stops at
  the first failing step with that step's exit code.
- Server: `status`, `stop`, `restart`, `doctor`, `purge --yes [--all]`.

Global options: `--headed`, `--profile <name|path>`, `--ephemeral`,
`--proxy <url>` (also from `BROWSE_PROXY_URL` or `HTTPS_PROXY`; `direct`
turns it off), `--session <name>`, `--timeout <ms>`, `--json`.

Stealth is limited to the basics: no automation flag, `navigator.webdriver`
false, and the same plain Chrome user agent in both modes. Sites with
strong bot detection can still tell; hand off rather than trying to defeat
them. Use authentication, header, cookie, storage, user-agent and
JavaScript commands only when the flow requires them.
