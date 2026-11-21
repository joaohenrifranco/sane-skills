# sane-skills

Opinionated agent skills for planning, code review, debugging, QA, and performance
measurement. A bundle of six workflow skills that were previously maintained
inside a private monorepo and are now distributed stand-alone through the
[Agent Skills](https://github.com/github/agent-skills) ecosystem, installable
with `gh skill install`.

## What's inside

| Skill | Version | Purpose | Depends on |
|---|---|---|---|
| `sane-code` | 2.0.0 | Domain-centered code rules + independent category review orchestration | — |
| `sane-plan` | 4.0.0 | Smallest-defensible-design planning with explicit boundaries and tradeoffs | `sane-code` (rules) |
| `sane-debug` | 3.0.0 | Evidence-led root-cause investigation, minimal fix, and verification | — |
| `sane-qa` | 2.0.0 | Risk-scoped browser QA with reproducible evidence and safe fix handoff | `sane-browse`, `sane-debug` |
| `sane-browse` | 3.0.0 | Headless/headed browser evidence, user handoff, persistent per-project sessions | — |
| `sane-benchmark` | 5.0.0 | Context-preserving runtime measurement, diagnosis, and comparison | `sane-browse`, `sane-debug` |

Bundle-style install is recommended: `sane-qa`, `sane-benchmark`, and
`sane-plan` reference sibling skills by name and resolve only when the related
skills are installed side by side.

## Requirements

- GitHub CLI v2.90.0+ (with `gh skill`; preview feature)

## Install

Install the whole bundle:

```bash
gh skill install joaohenrifranco/sane-skills --all
```

Install individual skills:

```bash
gh skill install joaohenrifranco/sane-skills sane-qa
gh skill install joaohenrifranco/sane-skills sane-code
```

Pin a revision for reproducibility:

```bash
gh skill install joaohenrifranco/sane-skills --all --pin <sha>
```

Update installed skills later with `gh skill update` (or reinstall).

### Requirements of the browser skills

`sane-browse`, `sane-qa`, and `sane-benchmark` drive a browser through `$B`,
the launcher at `skills/sane-browse/browse/bin/browse`. It needs
[Bun](https://bun.sh); on first run it installs its dependencies and
Playwright's Chromium (~150MB) by itself, and `browse doctor` reports what is
missing. State, logs and the per-project browser profile live in
`~/.cache/sane-browse` (`BROWSE_HOME` overrides), never in your repository.

Platforms: macOS and Linux (headed mode on a display-less Linux host uses
Xvfb when installed). Copying cookies from the user's own browser (Chrome,
Chromium, Brave, Edge, Arc, Comet on macOS; Firefox everywhere) is opt-in via
`--unsafe-copy-browser-cookies` and temporary by default. `browse purge --yes`
deletes a project's stored profile and state. Windows is untested.

Tests: `cd skills/sane-browse/browse && bun install && bun test`
(`BROWSE_TEST_HEADED=0` skips the tests that open a visible browser).

## Alternative installers

- [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI:
  `npx skills add joaohenrifranco/sane-skills --all` (also discovers
  `.agents/skills/` layouts).
- Manual: clone the repo and copy `skills/<name>/` into your agent's skills
  directory.

## Repository layout

```
skills/<name>/SKILL.md     # a skill directory, self-contained
skills/sane-code/rules/    # canonical generic engineering rules
skills/sane-browse/browse/ # browser daemon bundled with sane-browse
scripts/vet.sh             # bundle validation (frontmatter, rule IDs,
                           # project-agnostic gate, reference resolution)
```

`gh skill install` discovers skills via the Agent Skills spec conventions
(`skills/<name>/SKILL.md`, `skills/<scope>/<name>/SKILL.md`,
`<name>/SKILL.md`, `plugins/<scope>/skills/<name>/SKILL.md`).

## Contributing

The skills are the canonical home for generic engineering guidance:

- Keep every skill self-contained and project-agnostic — `scripts/vet.sh`
  fails if `sane-code/rules/` uses project-specific vocabulary or if
  cross-skill references do not resolve.
- Every `SKILL.md` carries `name`, `version`, and `description` frontmatter.
  Rules and workflow steps use unique semantic IDs such as
  `[SANE-ARCH-INWARD-DEPENDENCIES]` and `[SANE-PLAN-DEFINE-PROBLEM]`. IDs name
  enduring policies, remain stable across editorial changes, and give users a
  precise policy to accept, challenge, or override in project guidance.
- Bump all skill versions together per release; tag the repo (e.g. `v1.1.0`)
  and document pins in consuming projects.
