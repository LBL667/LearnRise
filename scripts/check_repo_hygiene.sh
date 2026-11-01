#!/usr/bin/env bash
# Gate: repository hygiene. Every assertion below must hold on a clean
# submission-ready tree; the FIRST violation is printed and the script
# exits 1. Runs with zero arguments, robust to any cwd.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# The outer repo (parent of LearnRise) must be untouched. This commit is
# recorded at T01/T02 and must never move; if the parent path is not a git
# repo the check is skipped (a SKIP is printed, not a failure).
OUTER_HEAD_EXPECTED="f15f8fc"

fail() {
  echo "repo-hygiene: FAIL - $1" >&2
  exit 1
}

# 1) Working tree must be completely clean (no uncommitted or untracked).
dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  echo "repo-hygiene: uncommitted/untracked files present:" >&2
  echo "$dirty" >&2
  fail "git status --porcelain is not empty"
fi

# 2) The diff file set against main must stay inside the plan whitelist.
banned="$(git diff --name-only main...HEAD | grep -E '^(.sisyphus/|docs/submission/|bench/)' || true)"
if [[ -n "$banned" ]]; then
  echo "repo-hygiene: diff vs main contains banned paths:" >&2
  echo "$banned" >&2
  fail "diff vs main touches banned top-level paths (.sisyphus/, docs/submission/, bench/)"
fi
banned="$(git diff --name-only main...HEAD | grep -E '(^|/)(node_modules|\.venv|dist)/' || true)"
if [[ -n "$banned" ]]; then
  echo "$banned" >&2
  fail "diff vs main contains node_modules/, .venv/ or dist/ paths"
fi
banned="$(git diff --name-only main...HEAD | grep -E '^var/' || true)"
if [[ -n "$banned" ]]; then
  echo "$banned" >&2
  fail "diff vs main contains var/ (runtime) paths"
fi
# Bare .env is banned; .env.example / .env.demo are allowed.
banned="$(git diff --name-only main...HEAD | grep -E '(^|/)\.env$' || true)"
if [[ -n "$banned" ]]; then
  echo "$banned" >&2
  fail "diff vs main contains a bare .env file (only .env.example/.env.demo are allowed)"
fi
banned="$(git diff --name-only main...HEAD | grep -E '\.vue$' || true)"
if [[ -n "$banned" ]]; then
  echo "$banned" >&2
  fail "diff vs main contains .vue files (Vue frontend must not enter the repo)"
fi

# 3) No generated/runtime directory may be tracked.
tracked="$(git ls-files | grep -E '(^|/)(node_modules|\.venv|dist|var)/' || true)"
if [[ -n "$tracked" ]]; then
  echo "$tracked" >&2
  fail "tracked files under node_modules/, .venv/, dist/ or var/"
fi

# 4) Exactly ONE .git directory in the tree.
gitdirs="$(find . -name .git -not -path './node_modules/*' | wc -l)"
if [[ "$gitdirs" -ne 1 ]]; then
  fail "expected exactly 1 .git directory, found ${gitdirs}"
fi

# 5) No tracked file larger than 1 MB may exist without being declared in
#    the allowlist below.
#
# ALLOWLIST (every entry is justified; verify with: stat -c%s <path>):
#   fixtures/lec01.pdf       -> 47588 bytes   (NOT >1MB; listed for reference only)
#   fixtures/board.png       -> 12647 bytes   (NOT >1MB; listed for reference only)
#   frontend/package-lock.json -> NOT tracked in this repo (absent at commit time)
# At the time this gate was written, NO tracked file exceeds 1 MB, so the
# allowlist is intentionally empty. If a >1MB fixture is ever added, it must
# be added here with a comment before the file is committed.
ALLOWED_OVERRSIZE=""
oversize="$(git ls-files -z | xargs -0 -I{} sh -c 'test $(stat -c%s "{}") -gt 1048576 && echo "{}"' || true)"
if [[ -n "$oversize" ]]; then
  # Strip entries that are explicitly allowed (newline-separated exact matches).
  if [[ -n "$ALLOWED_OVERRSIZE" ]]; then
    oversize="$(echo "$oversize" | grep -v -F -x -f <(printf '%s\n' "$ALLOWED_OVERRSIZE") || true)"
  fi
  if [[ -n "$oversize" ]]; then
    echo "$oversize" >&2
    fail "tracked files larger than 1 MB without an allowlist entry"
  fi
fi

# 6) The outer repository's HEAD must be unchanged.
outer_parent="$(cd "$ROOT/.." && pwd)"
if git -C "$outer_parent" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  outer_head="$(git -C "$outer_parent" log --oneline -1)"
  if [[ "${outer_head%% *}" != "$OUTER_HEAD_EXPECTED" ]]; then
    fail "outer repo HEAD moved: expected ${OUTER_HEAD_EXPECTED}, got ${outer_head}"
  fi
else
  echo "SKIP: outer repo is not a git repository; skipping outer-HEAD check"
fi

echo "repo-hygiene: clean"
exit 0
