#!/usr/bin/env bash
# Validate the published skill bundle: layout, frontmatter, rule-ID hygiene,
# a project-agnostic gate on the generic rules, and cross-skill reference
# resolution. Mirrors the gate the skills were kept behind in their source repo.
set -euo pipefail

cd "$(dirname "$0")/.."
FAIL=0
fail() { printf 'FAIL %s\n' "$*"; FAIL=$((FAIL + 1)); }
pass() { printf 'PASS %s\n' "$*"; }

SKILLS=()
while IFS= read -r f; do SKILLS+=("$f"); done < <(find skills -mindepth 2 -maxdepth 2 -name SKILL.md | sort)
if [ "${#SKILLS[@]}" -eq 0 ]; then
  fail "no skills/<name>/SKILL.md found (invalid for gh skill install)"
else
  pass "discoverable skills: $(printf '%s ' "${SKILLS[@]}")"
fi

# 1. Frontmatter: name, version, description present in every SKILL.md
for f in "${SKILLS[@]}"; do
  n=$(awk 'NR<=6 && /^name:/{print FILENAME; exit}' "$f")
  v=$(awk 'NR<=6 && /^version:/{print NR; exit}' "$f")
  d=$(awk 'NR<=12 && /^description:/{print NR; exit}' "$f")
  name=$(basename "$(dirname "$f")")
  if [ -n "$n" ] && [ -n "$v" ] && [ -n "$d" ]; then
    pass "frontmatter $name (version line $v, description line $d)"
  else
    fail "frontmatter incomplete in $name: name=$([ -n "$n" ] && echo ok || echo MISSING) version=$([ -n "$v" ] && echo ok || echo MISSING) description=$([ -n "$d" ] && echo ok || echo MISSING)"
  fi
done

# 2. SANE rule IDs are unique semantic identifiers across rules and workflows
DUPES=$(grep -ohE '\[SANE-[A-Z0-9-]+\]' skills/*/SKILL.md skills/sane-code/rules/*.md 2>/dev/null | sort | uniq -d || true)
if [ -n "$DUPES" ]; then
  fail "duplicate SANE rule IDs: ${DUPES//$'\n'/ }"
else
  pass "SANE rule IDs unique"
fi

INVALID_IDS=$(grep -ohE '\[SANE-[^]]+\]' skills/*/SKILL.md skills/sane-code/rules/*.md 2>/dev/null | grep -Ev '^\[SANE-[A-Z]+-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*\]$' | sort -u || true)
if [ -n "$INVALID_IDS" ]; then
  fail "non-semantic or malformed SANE rule IDs: ${INVALID_IDS//$'\n'/ }"
else
  pass "SANE rule IDs use semantic names"
fi

# 3. Generic rules stay project-agnostic (no host-project vocabulary)
if grep -R -n -E 'Momo|mise run|Supabase|Capacitor|PostHog|Tailwind|React' skills/sane-code/rules 2>/dev/null; then
  fail "generic rules contain project-specific vocabulary"
else
  pass "generic rules are project-agnostic"
fi

# 4. No legacy rule index or numeric rule IDs
if grep -R -n -E '^## Rule Index|\[(CODE|DESIGN|AUTH|SEC|DB|PLATFORM|PERF|TESTS|STRATEGY)-[0-9]+\]|\[SANE-[A-Z]+-(STEP-)?[0-9]+\]' skills 2>/dev/null; then
  fail "legacy rule index or legacy rule IDs remain"
else
  pass "no legacy rule index or numeric IDs"
fi

# 5. Cross-skill references (backticked sane-* names) resolve inside the bundle
MISSING=0
for f in "${SKILLS[@]}"; do
  for ref in $(grep -ohE '`sane-[a-z-]+`' "$f" | tr -d '`' | sort -u); do
    if [ ! -d "skills/$ref" ]; then
      echo "  $f references missing skill: $ref"
      MISSING=1
    fi
  done
done
if [ "$MISSING" -eq 0 ]; then
  pass "cross-skill references resolve"
else
  fail "unresolved cross-skill references"
fi

# 6. No inline JS passed to $B eval (eval reads a file; expressions must use js)
if grep -R -n -E '\$B eval "' skills/*/SKILL.md 2>/dev/null; then
  fail "inline JS passed to \$B eval (use \$B js for expressions)"
else
  pass "no inline \$B eval misuse"
fi

# 7. README version table matches SKILL.md frontmatter
VERSYNC=0
for f in "${SKILLS[@]}"; do
  name=$(basename "$(dirname "$f")")
  ver=$(awk 'NR<=6 && /^version:/{print $2; exit}' "$f")
  row=$(printf '| `%s` | %s |' "$name" "$ver")
  if ! grep -Fq "$row" README.md; then
    echo "  README.md missing version row: $row"
    VERSYNC=1
  fi
done
if [ "$VERSYNC" -eq 0 ]; then
  pass "README version table matches frontmatter"
else
  fail "README version table out of sync"
fi

[ "$FAIL" -eq 0 ] || { printf 'vet FAILED with %d failure(s)\n' "$FAIL"; exit 1; }
printf 'vet PASSED\n'