#!/usr/bin/env bash
# Fail when a vendor SDK leaks outside the adapter layer.
#
# The application core must stay cloud-agnostic: only files under
# backend/app/adapters/ may import a concrete provider SDK. This gate scans
# backend/app (excluding adapters) for forbidden imports and reports
# offenders as file:line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_DIR="$ROOT/backend/app"
EXCLUDE_DIR="$ROOT/backend/app/adapters"

FORBIDDEN_MODS="huaweicloudsdkcore|huaweicloudsdkocr|huaweicloudsdk|openai|boto3|minio|obs"
IMPORT_RE="^[[:space:]]*(import|from)[[:space:]]+(${FORBIDDEN_MODS})([[:space:].,]|$)"

if [[ ! -d "$SCAN_DIR" ]]; then
  echo "isolation: scan directory not found: $SCAN_DIR" >&2
  exit 2
fi

violations="$(
  grep -rnE "$IMPORT_RE" "$SCAN_DIR" --include='*.py' 2>/dev/null \
    | grep -vE "^${EXCLUDE_DIR}/" \
    || true
)"

if [[ -n "$violations" ]]; then
  echo "isolation: forbidden provider SDK import(s) outside adapters:" >&2
  printf '%s\n' "$violations" >&2
  exit 1
fi

echo "isolation: clean (no forbidden imports outside backend/app/adapters/)"
exit 0
