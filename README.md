# sane-skills

Portable agent skills for planning, code review, debugging, QA, and performance
measurement. A bundle of six workflow skills that were previously maintained
inside a private monorepo and are now distributed stand-alone through the
[Agent Skills](https://github.com/github/agent-skills) ecosystem, installable
with `gh skill install`.

## What's inside

| Skill | Version | Purpose | Depends on |
|---|---|---|---|
| `sane-code` | 1.0.0 | Portable code standards (`rules/`) + independent category review orchestration | — |
| `sane-plan` | 3.0.0 | Planning workflow: map, scope, compare options, record decisions | `sane-code` (rules) |
| `sane-debug` | 2.1.0 | Root-cause investigation: evidence, minimal fix, regression | — |
| `sane-qa` | 1.0.0 | Browser QA: health scores, evidence, fix → re-test loop | `sane-browse`, `sane-debug` |
| `sane-browse` | 1.0.0 | Headless browser runtime (`browse/` daemon) + command reference | — |
| `sane-benchmark` | 4.0.0 | Runtime performance measurement, baselines, regressions | `sane-browse`, `sane-debug` |

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

`sane-browse`, `sane-qa`, and `sane-benchmark` drive a headless browser through
a `$B` command supplied by the host project or environment. The browse runtime
ships in `skills/sane-browse/browse/` (Bun + Playwright daemon); host projects
install it and expose it as `$B`, or provide an equivalent runtime. The skills
never assume a package manager, repository path, or installation command.

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
- Every `SKILL.md` carries `name`, `version`, and `description` frontmatter;
  rule IDs are `[SANE-<CATEGORY>-<NN>]` and must be unique across the bundle.
- Bump all skill versions together per release; tag the repo (e.g. `v1.1.0`)
  and document pins in consuming projects.

## Attribution

Extracted from the `.agents/skills/sane-*` directory of the momo monorepo
(107 commits of iteration) and made portable.