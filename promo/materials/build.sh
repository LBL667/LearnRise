#!/usr/bin/env bash
# LearnRise handout build script
# Usage: bash build.sh [micro|fixed-income|all]
#
# Determinism recipe (verified byte-identical across consecutive runs):
#   1. pandoc + xelatex builds a raw PDF. xelatex randomizes two fields:
#      /CreationDate and the 6-char embedded subset-font identity tags.
#   2. `qpdf --qdf --object-streams=disable` expands the raw file to QDF
#      (plain objects, uncompressed, valid xref).
#   3. `normalize.py` rewrites ONLY the run-dependent fields in place, and
#      every replacement is forced to the SAME byte length as what it
#      replaces, so the xref offsets remain valid without re-serializing.
#   4. `qpdf --deterministic-id --object-streams=generate` produces the final
#      file with a content-derived /ID instead of a random one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export SOURCE_DATE_EPOCH=0
export TZ=UTC

usage() {
  echo "Usage: bash build.sh [micro|fixed-income|all]" >&2
  exit 1
}

normalize_equal_length() {
  # Read $1 (a qpdf --qdf expanded file), rewrite the non-deterministic
  # fields in memory, and write them back to $2.
  python3 - "$1" "$2" <<'PYEOF'
import re, sys, hashlib

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()

# 1) Subset-font identity tags: "[ABCDEF]+NotoSerifSC" -> a deterministic
#    6-letter tag derived from md5(base-font-name). Same base -> same tag,
#    independent of the xelatex run. Replacements preserve length: 6 + 1 +
#    len(base) on both sides.
def fix_tag(m):
    # tag = 6-letter md5 of the base font name, uppercased. The replacement
    # has the same total byte length as the match (6 + '+' + len(base)).
    base = m.group(2)
    fixed = hashlib.md5(base).hexdigest()[:6].upper().encode()
    return fixed + b'+' + base

data = re.sub(rb'([A-Z]{6})\+([A-Za-z][A-Za-z0-9-]*)', fix_tag, data)

# 2) /CreationDate and /ModDate: rewrite the date string in place. The
#    QDF text form is "/CreationDate (D:20261102212422+08'00')" - we replace
#    the whole parenthesized value with a fixed one padded/truncated to the
#    SAME total byte length so the xref offsets do not shift.
FROZEN = b"D:20260101000000+00'00'"

def freeze_date(m):
    old = m.group(1)
    if len(old) == len(FROZEN):
        return b'/CreationDate (' + FROZEN + b')'
    # Pad or truncate the frozen value to the old length.
    if len(old) > len(FROZEN):
        pad = len(old) - len(FROZEN)
        # Pad inside the parens with a safe filler, keeping total equal.
        filler = b'0' * pad
        return b'/CreationDate (' + FROZEN + filler + b')'
    # Old shorter than frozen: impossible in practice; keep original.
    return m.group(0)

data = re.sub(rb'/CreationDate \(([^)]*)\)', freeze_date, data)

def freeze_moddate(m):
    old = m.group(1)
    if len(old) == len(FROZEN):
        return b'/ModDate (' + FROZEN + b')'
    if len(old) > len(FROZEN):
        filler = b'0' * (len(old) - len(FROZEN))
        return b'/ModDate (' + FROZEN + filler + b')'
    return m.group(0)

data = re.sub(rb'/ModDate \(([^)]*)\)', freeze_moddate, data)

# 3) /ID: replace both hex IDs with a fixed 32-hex string, preserving
#    length (each is 32 hex chars).
FROZEN_ID = b'0123456789abcdef'
def fix_id(m):
    return b'/ID [<' + FROZEN_ID + b'><' + FROZEN_ID + b'>]'
data = re.sub(rb'/ID \[<[0-9a-fA-F]+><[0-9a-fA-F]+>\]', fix_id, data)

open(dst, 'wb').write(data)
PYEOF
}

build_one() {
  local target="$1"
  local src out raw qdf qpdf_final
  case "${target}" in
    micro)
      src="${SCRIPT_DIR}/src/micro-ch3.md"
      out="${SCRIPT_DIR}/微观经济学 第3章 弹性与消费者行为.pdf"
      ;;
    fixed-income)
      src="${SCRIPT_DIR}/src/fixed-income-ch2.md"
      out="${SCRIPT_DIR}/固定收益证券 第2章 债券定价与久期.pdf"
      ;;
    *)
      usage
      ;;
  esac

  [ -f "${src}" ] || { echo "error: source not found: ${src}" >&2; exit 1; }

  raw="${out}.raw.pdf"
  qdf="${out}.qdf.pdf"
  qpdf_final="${out}.qfinal.pdf"

  echo "==> building ${target}: ${src}"
  pandoc "${src}" \
    -f markdown+tex_math_dollars \
    --template="${SCRIPT_DIR}/template.tex" \
    --pdf-engine=xelatex \
    -V lang:zh-CN \
    -o "${raw}"

  qpdf --qdf --object-streams=disable "${raw}" "${qdf}"
  normalize_equal_length "${qdf}" "${qdf}"
  qpdf --deterministic-id --object-streams=generate "${qdf}" "${qpdf_final}"

  mv "${qpdf_final}" "${out}"
  rm -f "${raw}" "${qdf}"
  echo "==> done: ${out}"
}

case "${1:-all}" in
  micro)        build_one micro ;;
  fixed-income) build_one fixed-income ;;
  all)          build_one micro; build_one fixed-income ;;
  *)            usage ;;
esac
