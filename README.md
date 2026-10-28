# sane-skills

Opinionated agent skills for planning, code review, debugging, QA, and performance
measurement. A bundle of six workflow skills that were previously maintained
inside a private monorepo and are now distributed stand-alone through the
[Agent Skills](https://github.com/github/agent-skills) ecosystem, installable
with `gh skill install`.

## What's inside

| Skill | Version | Purpose | Depends on |
|---|---|---|---|
| `sane-code` | 6.0.0 | Domain-centered code rules (architecture, correctness, security, tests, performance, UI, operations), shared conventions, and independent category review orchestration | — |
| `sane-plan` | 6.0.0 | Smallest-defensible-design planning with explicit boundaries and tradeoffs | `sane-code` (rules) |
| `sane-debug` | 6.0.0 | Evidence-led root-cause investigation, minimal fix, and verification | `sane-code` (rules, conventions) |
| `sane-qa` | 6.0.0 | Risk-scoped browser QA with reproducible evidence and safe fix handoff | `sane-browse`, `sane-debug`, `sane-code` (conventions) |
| `sane-browse` | 6.0.0 | Focused browser interaction and observable evidence collection | — |
| `sane-benchmark` | 6.0.0 | Context-preserving runtime measurement, diagnosis, and comparison | `sane-browse`, `sane-debug`, `sane-code` (conventions) |

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
never assume a package manager, repository path, or installation command, so a
host should document its setup in its own agent instructions.

`$B` must be a single executable, because a shell variable holding a multi-word
command is not word-split by zsh or fish. One way to provide it:

```bash
(cd skills/sane-browse/browse && bun install && bunx playwright install chromium)

# wrapper script on PATH, or a path the host documents
cat > browse <<'EOF'
#!/usr/bin/env bash
exec bun run /path/to/skills/sane-browse/browse/src/cli.ts "$@"
EOF
chmod +x browse
B=./browse
```

`$B --help` lists every command. `$B eval <file>` reads only files inside the
working directory or the system temporary directory.

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
skills/sane-code/conventions.md # severity, PR comment envelope, handoff packet
skills/sane-benchmark/scripts/ # measurement scripts run with `$B eval`
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
  and document pins in consuming projects. `scripts/vet.sh` fails when versions
  differ.
- Put a rule or step ID at the start of its heading, and cite another ID in prose
  without brackets (`SANE-ARCH-LOCAL-CONSISTENCY`); bracketed IDs are reserved for
  the heading that defines them.
- Cite a rule instead of restating it. Workflow skills own procedure; the rules own
  policy.
