#!/usr/bin/env bash
# Gate: legacy project name must not reappear anywhere in the repository.
#
# Five independent scans; every hit is printed as file:line:text (or
# name:text where a line number does not apply). Exit 1 if ANY hit,
# 0 when clean. Runs with zero arguments and is robust to any cwd.
#
# The scan set is "what could end up in the repo": all TRACKED files plus
# all UNTRACKED, non-ignored files. Scans 1-3 cover both layers (tracked via
# git grep / git ls-files, untracked via
# git ls-files --others --exclude-standard), so an untracked probe file
# (negative self-test) is caught, while ignored trees like node_modules are
# never scanned.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# The literal forbidden tokens are written in this very script, so this
# file must be excluded from every scan below, otherwise the gate would
# always trip on its own patterns. Exclusion is ONLY for this script;
# no other path class may be excluded.
SELF="scripts/check_legacy_name.sh"

# The old name "zhixue" / "智学" / "closed-loop" patterns.
PATTERN='zhixue|智学|closed[-_ ]?loop'

STATUS=0

# All files the next `git add` could pick up: tracked + untracked,
# non-ignored. NUL-delimited, binary-safe, minus the self-excluded file.
all_files() {
  { git ls-files -z -- .; git ls-files -z --others --exclude-standard; } \
    | sort -z -u | grep -zvxF -- "$SELF"
}

# Binary-safe content hits on the full file set (what the task's per-file
# grep -a -l loop does, but NUL-safe and including untracked files).
content_hits() {
  all_files | xargs -0 -r grep -a -l -i -E "$PATTERN" -- 2>/dev/null
}

echo "[1/5] tracked content"
if git grep -I -i -n -E "$PATTERN" -- . ":(exclude)$SELF"; then
  STATUS=1
fi
# git grep -I only reports tracked, text-detected files; report the whole
# file set so binary and untracked hits are printed too.
if content_hits; then
  STATUS=1
fi
[[ $STATUS -eq 1 ]] || echo "    ok"

echo "[2/5] file names"
if all_files | tr '\0' '\n' | grep -i -E 'zhixue|closed[-_ ]?loop'; then
  STATUS=1
else
  echo "    ok"
fi

echo "[3/5] binary/undetected content"
if content_hits; then
  STATUS=1
else
  echo "    ok"
fi

echo "[4/5] branch/tag names"
if { git branch -a --format='%(refname:short)' || true; } | grep -i -E 'zhixue|closed[-_ ]?loop'; then
  STATUS=1
fi
if { git tag || true; } | grep -i -E 'zhixue|closed[-_ ]?loop'; then
  STATUS=1
fi
[[ $STATUS -eq 1 ]] || echo "    ok"

echo "[5/5] commit messages (last 200)"
if { git log --format='%h %s' -n 200; git log --format='%b' -n 200; } \
  | grep -i -E 'zhixue|智学|closed[-_ ]?loop'; then
  STATUS=1
else
  echo "    ok"
fi

if [[ $STATUS -ne 0 ]]; then
  echo "legacy-name: FOUND legacy project name hits (see above)" >&2
  exit 1
fi

echo "legacy-name: clean"
exit 0
