#!/usr/bin/env bash
# Gate: compare a pytest junit xml against the recorded test baseline.
#
#   scripts/compare_test_baseline.sh <junit.xml> [baseline.json]
#
# Rules (see scripts/test-baseline.json "policy"):
#   - failed  must be 0
#   - errors  must be 0
#   - passed  must be >= baseline.passed
#   - tests   must be >= baseline.collected
#   - skipped must be <= baseline.skipped
#
# Exits 0 when every rule holds, 1 when any rule is violated, 2 on bad usage
# or unreadable input. No `|| true` anywhere: the exit status is the verdict.
set -euo pipefail

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

XML="${1:-}"
BASELINE="${2:-${ROOT}/scripts/test-baseline.json}"

if [[ -z "$XML" ]]; then
  echo "usage: $0 <junit.xml> [baseline.json]" >&2
  exit 2
fi
if [[ ! -f "$XML" ]]; then
  echo "baseline-compare: junit xml not found: $XML" >&2
  exit 2
fi
if [[ ! -f "$BASELINE" ]]; then
  echo "baseline-compare: baseline json not found: $BASELINE" >&2
  exit 2
fi

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "baseline-compare: no python interpreter found" >&2
  exit 2
fi

"$PY" - "$XML" "$BASELINE" <<'PYTHON'
import json
import re
import sys

xml_path, baseline_path = sys.argv[1], sys.argv[2]

with open(baseline_path, encoding="utf-8") as fh:
    baseline = json.load(fh)

with open(xml_path, encoding="utf-8", errors="replace") as fh:
    xml = fh.read()

match = re.search(r"<testsuite\b[^>]*>", xml)
if not match:
    print("baseline-compare: no <testsuite> element found in the junit xml", file=sys.stderr)
    sys.exit(2)

attrs = dict(re.findall(r'(\w+)="([^"]*)"', match.group(0)))
try:
    actual = {key: int(attrs[key]) for key in ("tests", "failures", "errors", "skipped")}
except KeyError as exc:  # pragma: no cover - malformed xml
    print(f"baseline-compare: junit suite is missing attribute {exc}", file=sys.stderr)
    sys.exit(2)

passed = actual["tests"] - actual["failures"] - actual["errors"] - actual["skipped"]

rows = [
    ("collected", baseline.get("collected", baseline.get("tests", 0)), actual["tests"], ">="),
    ("passed", baseline["passed"], passed, ">="),
    ("skipped", baseline["skipped"], actual["skipped"], "<="),
    ("failed", baseline.get("failed", 0), actual["failures"], "=="),
    ("errors", baseline.get("errors", 0), actual["errors"], "=="),
]

print("baseline-compare: junit vs recorded baseline")
print(f"  {'metric':<10} {'baseline':>9} {'actual':>9}  rule")
violations = []
for name, expected, observed, rule in rows:
    print(f"  {name:<10} {expected:>9} {observed:>9}  {rule} {expected}")
    if rule == ">=" and observed < expected:
        violations.append(f"{name}: {observed} < baseline {expected}")
    elif rule == "<=" and observed > expected:
        violations.append(f"{name}: {observed} > baseline {expected}")
    elif rule == "==" and observed != expected:
        violations.append(f"{name}: {observed} != expected {expected}")

if violations:
    print("\nbaseline-compare: FAIL", file=sys.stderr)
    for violation in violations:
        print(f"  - {violation}", file=sys.stderr)
    sys.exit(1)

print("\nbaseline-compare: OK (no regression against the recorded baseline)")
PYTHON
