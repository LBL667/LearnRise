#!/usr/bin/env bash
# Provider-parity harness: runs one identical contract suite under each profile.
#
#   PROVIDER_PROFILE=local  scripts/parity_check.sh   # exit 0 all PASS, 1 on FAIL
#   PROVIDER_PROFILE=huawei scripts/parity_check.sh   # exit 3 when blocked by missing creds
#
# Every check prints one `PASS` / `FAIL` / `SKIP(<profile>)` line with its measured
# latency and a one-line detail. Exit codes:
#   0  every check ran and passed
#   1  at least one check failed
#   3  no failures, but at least one check was skipped (blocked, not green)
#   2  usage error (unknown PROVIDER_PROFILE)
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${PROVIDER_PROFILE:-local}"
COMPOSE=(docker compose -f "${COMPOSE_FILE:-docker-compose.yml}")
BASE_URL="${PARITY_BASE_URL:-http://localhost:8000}"
MAAS_BASE_URL="${MAAS_BASE_URL:-https://api.modelarts-maas.com/openai/v1}"

TOTAL=0 PASS=0 FAIL=0 SKIP=0
SCRIPT_START="$(date +%s%3N)"

now_ms() { date +%s%3N; }

record() {
  local status="$1" name="$2" ms="$3"
  shift 3
  TOTAL=$((TOTAL + 1))
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP*) SKIP=$((SKIP + 1)) ;;
  esac
  if [ "$status" = "PASS" ] || [ "$status" = "FAIL" ]; then
    ms="${ms}ms"
  fi
  printf '%-14s %-22s %8s  %s\n' "$status" "$name" "$ms" "$*"
}

missing_env() {
  local out="" name
  for name in "$@"; do
    [ -n "${!name:-}" ] || out="${out:+$out,}$name"
  done
  printf '%s' "$out"
}

# run_check <name> <space-separated required env> -- <command...>
# The requirement gate only applies to the huawei profile; local checks always run.
run_check() {
  local name="$1" requires="$2"
  shift 2
  [ "${1:-}" = "--" ] && shift

  # shellcheck disable=SC2086
  local gate
  gate=""
  if [ "$PROFILE" = "huawei" ] && [ -n "$requires" ]; then
    gate="$(missing_env $requires)"
  fi
  if [ -n "$gate" ]; then
    record "SKIP(huawei)" "$name" "-" "missing $gate"
    return 0
  fi

  local start end out rc
  start="$(now_ms)"
  out="$("$@" 2>&1)"
  rc=$?
  end="$(now_ms)"
  if [ "$rc" -eq 0 ]; then
    record "PASS" "$name" "$((end - start))" "$(printf '%s\n' "$out" | tail -n 1)"
  else
    record "FAIL" "$name" "$((end - start))" "$(printf '%s\n' "$out" | tail -n 5 | tr '\n' ' ')"
  fi
  return 0
}

exec_backend() {
  local flags=()
  while [ "$#" -gt 0 ] && [ "${1:-}" = "-e" ]; do
    flags+=("$1" "$2")
    shift 2
  done
  "${COMPOSE[@]}" exec -T "${flags[@]}" backend "$@"
}

rds_url() {
  local raw="$1"
  case "$raw" in
    postgresql://*) printf 'postgresql+psycopg://%s' "${raw#postgresql://}" ;;
    *) printf '%s' "$raw" ;;
  esac
}

db_query() {
  local sql="$1"
  if [ "$PROFILE" = "huawei" ]; then
    exec_backend -e DATABASE_URL="$(rds_url "$RDS_URL")" python - "$sql" <<'PY'
import sys

from sqlalchemy import text

from app.db import engine

with engine.connect() as conn:
    value = conn.execute(text(sys.argv[1])).scalar()
print("" if value is None else value)
PY
  else
    "${COMPOSE[@]}" exec -T db psql -U learnrise -d learnrise -tAc "$sql"
  fi
}

alembic_cli() {
  if [ "$PROFILE" = "huawei" ]; then
    exec_backend -e DATABASE_URL="$(rds_url "$RDS_URL")" alembic "$@"
  else
    exec_backend alembic "$@"
  fi
}

preflight() {
  [ "$PROFILE" = "huawei" ] && return 0
  local running
  running="$("${COMPOSE[@]}" ps --status running --services 2>/dev/null || true)"
  local service
  for service in backend db; do
    if ! printf '%s\n' "$running" | grep -qx "$service"; then
      echo "fatal: compose service '$service' is not running; run 'docker compose -f ${COMPOSE_FILE:-docker-compose.yml} up -d'" >&2
      exit 1
    fi
  done
}

check_health() {
  exec_backend python - "$BASE_URL/api/health" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
with urllib.request.urlopen(url, timeout=5) as resp:
    body = json.loads(resp.read() or b"{}")
    assert resp.status == 200, resp.status
    assert body.get("status") == "ok", body
print(f"GET {url} -> 200 {body}")
PY
}

check_db_extension() {
  local version
  version="$(db_query "SELECT extversion FROM pg_extension WHERE extname = 'vector'")" || return 1
  version="${version//[[:space:]]/}"
  [ -n "$version" ] || { echo "pg_extension 'vector' is not installed"; return 1; }
  echo "pg_extension vector=$version"
}

check_alembic() {
  local heads current count head_rev current_rev
  heads="$(alembic_cli heads 2>&1)" || { echo "alembic heads failed: $heads"; return 1; }
  count="$(printf '%s\n' "$heads" | grep -c '(head)' || true)"
  [ "$count" -eq 1 ] || { echo "expected exactly 1 alembic head, got $count: $heads"; return 1; }
  head_rev="$(printf '%s\n' "$heads" | awk '/\(head\)/ {print $1; exit}')"
  current="$(alembic_cli current 2>&1)" || { echo "alembic current failed: $current"; return 1; }
  current_rev="$(printf '%s\n' "$current" | grep -E '^[0-9A-Za-z_]+ \(head\)' | awk '{print $1; exit}')"
  [ "$current_rev" = "$head_rev" ] || {
    echo "db revision '${current_rev:-none}' != alembic head '$head_rev'"
    return 1
  }
  echo "heads=$count head=$head_rev db_revision=$current_rev"
}

check_vector_roundtrip() {
  local envs=()
  if [ "$PROFILE" = "huawei" ]; then
    envs=(-e DATABASE_URL="$(rds_url "$RDS_URL")")
  fi
  exec_backend "${envs[@]}" python - <<'PY'
import uuid

from sqlalchemy import delete

from app.adapters.vector.pgvector_store import PgVectorStore
from app.db import SessionLocal
from app.models import Chunk, KnowledgeSource, User
from app.ports import ChunkRecord

DIM = 1024
uid = str(uuid.uuid4())
sid = str(uuid.uuid4())
cid = str(uuid.uuid4())
try:
    with SessionLocal() as db:
        db.add(User(id=uid, email=f"parity-{uid}@example.com", display_name="parity"))
        db.flush()
        db.add(
            KnowledgeSource(
                id=sid,
                user_id=uid,
                title="parity roundtrip",
                filename="parity.txt",
                content_type="text/plain",
                size_bytes=1,
                storage_key=f"parity/{sid}.txt",
            )
        )
        db.commit()
    store = PgVectorStore()
    vector = [0.0] * DIM
    vector[0] = 1.0
    record = ChunkRecord(
        chunk_id=cid,
        source_id=sid,
        content="parity vector roundtrip",
        page=None,
        heading=None,
        embedding=vector,
        embedding_model="parity-check",
        embedding_dim=DIM,
        embedding_version="1",
    )
    written = store.upsert([record])
    hits = store.search(vector, top_k=1, source_ids=[sid])
    store.close()
    assert written == 1, f"upsert wrote {written} rows"
    assert hits and hits[0].chunk_id == cid, f"search returned {hits}"
    print(f"upsert=1 search_hit={hits[0].chunk_id} score={hits[0].score:.4f} dim={DIM}")
finally:
    with SessionLocal() as db:
        db.execute(delete(Chunk).where(Chunk.source_id == sid))
        db.execute(delete(KnowledgeSource).where(KnowledgeSource.id == sid))
        db.execute(delete(User).where(User.id == uid))
        db.commit()
PY
}

check_embedding_dim() {
  local envs=()
  if [ "$PROFILE" = "huawei" ]; then
    envs=(
      -e EMBEDDING_PROVIDER=openai_compatible
      -e "EMBEDDING_BASE_URL=$MAAS_BASE_URL"
      -e "EMBEDDING_API_KEY=$MAAS_API_KEY"
      -e "EMBEDDING_MODEL=${MAAS_EMBED_MODEL:-bge-m3}"
      -e EMBEDDING_DIM=1024
    )
  fi
  exec_backend "${envs[@]}" python - <<'PY'
from app.adapters.embedding import build_embedding
from app.config import settings

assert int(settings.embedding_dim) == 1024, f"EMBEDDING_DIM={settings.embedding_dim}"
result = build_embedding(settings).embed(["parity embedding dimension probe"])
assert result.dim == 1024, f"provider reported dim {result.dim}"
assert len(result.vectors) == 1 and len(result.vectors[0]) == 1024, "vector width mismatch"
note = " offline" if settings.embedding_provider in {"mock", "offline", "hash"} else ""
print(f"provider={settings.embedding_provider} model={result.model} dim={result.dim}{note}")
PY
}

check_llm() {
  local envs=()
  if [ "$PROFILE" = "huawei" ]; then
    envs=(
      -e LLM_PROVIDER=maas
      -e "LLM_BASE_URL=$MAAS_BASE_URL"
      -e "LLM_API_KEY=$MAAS_API_KEY"
      -e "LLM_MODEL=${MAAS_MODEL:-deepseek-v4.1-flash}"
    )
  fi
  exec_backend "${envs[@]}" python - <<'PY'
import sys

from app.adapters.llm import build_llm
from app.config import settings
from app.ports import ChatMessage

provider = (settings.llm_provider or "").strip().lower()
if provider in {"mock", "offline"}:
    result = build_llm(settings).chat([ChatMessage(role="user", content="parity ping")], max_tokens=16)
    assert result.content, "mock provider returned empty content"
    print("provider=mock model=%s note=offline (no network)" % result.model)
    sys.exit(0)

if provider in {"openai_compatible", "maas", "modelarts", "modelarts_maas", "huawei", "huawei_maas"} and not settings.llm_api_key:
    print(f"FAIL: LLM_PROVIDER={provider} but LLM_API_KEY is empty")
    sys.exit(1)

result = build_llm(settings).chat([ChatMessage(role="user", content="parity ping")], max_tokens=16)
assert result.content, "provider returned empty content"
print(f"provider={provider} model={result.model} chars={len(result.content)}")
PY
}

check_storage() {
  local envs=()
  if [ "$PROFILE" = "huawei" ]; then
    envs=(
      -e STORAGE_PROVIDER=obs
      -e "OBS_ENDPOINT=$OBS_ENDPOINT"
      -e "OBS_BUCKET=$OBS_BUCKET"
      -e "OBS_ACCESS_KEY_ID=$OBS_ACCESS_KEY_ID"
      -e "OBS_SECRET_ACCESS_KEY=$OBS_SECRET_ACCESS_KEY"
    )
  fi
  exec_backend "${envs[@]}" python - <<'PY'
import uuid

from app.adapters.storage import build_storage
from app.config import settings

store = build_storage(settings)
key = f"parity/{uuid.uuid4().hex}.txt"
payload = b"parity storage roundtrip"
try:
    stored = store.put(key, payload, "text/plain")
    assert store.get(stored) == payload, "stored bytes differ"
    signed = store.sign(stored)
    assert signed, "sign() returned an empty URL"
    print(f"provider={settings.storage_provider} key={stored} sign={signed[:48]}")
finally:
    store.delete(key)
PY
}

check_ocr() {
  if [ "$PROFILE" = "huawei" ]; then
    exec_backend \
      -e OCR_PROVIDER=huawei \
      -e "HUAWEI_AK=$HUAWEI_AK" \
      -e "HUAWEI_SK=$HUAWEI_SK" \
      -e "HUAWEI_PROJECT_ID=${HUAWEI_PROJECT_ID:-}" \
      -e "HUAWEI_REGION=${OCR_REGION:-cn-north-4}" \
      python - <<'PY'
import struct
import zlib

from app.adapters.ocr import build_ocr
from app.config import settings


def tiny_png() -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    row = b"\x00\xff\xff\xff"
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row))
        + chunk(b"IEND", b"")
    )


result = build_ocr(settings).recognize(tiny_png(), content_type="image/png")
print(f"provider=huawei blocks={len(result.blocks)}")
PY
    return 0
  fi
  exec_backend python - <<'PY'
import json
import urllib.request

url = "http://ocr-service:8001/health"
with urllib.request.urlopen(url, timeout=10) as resp:
    body = json.loads(resp.read() or b"{}")
    assert resp.status == 200, resp.status
    assert body.get("status") == "ok", body
print(f"GET {url} -> 200 {body}")
PY
}

check_reminder_signature() {
  exec_backend python - "$BASE_URL" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

from app.api.internal import SIGNATURE_HEADER, TIMESTAMP_HEADER, compute_signature
from app.config import settings

base = sys.argv[1].rstrip("/")
url = f"{base}/internal/reminders/run"
secret = settings.cron_signature_secret
assert secret, "CRON_SIGNATURE_SECRET is empty"


def post(signature: str, timestamp: int) -> tuple[int, str | None]:
    request = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            TIMESTAMP_HEADER: str(timestamp),
            SIGNATURE_HEADER: signature,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as resp:
            return resp.status, None
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read() or b"{}")
        return exc.code, body.get("detail")


now = int(time.time())
code, detail = post("0" * 64, now)
assert (code, detail) == (401, "未认证"), f"tampered signature: {code} {detail}"
stale = now - 1000
code, detail = post(compute_signature(secret, stale, b"{}"), stale)
assert (code, detail) == (401, "签名已过期"), f"valid stale signature: {code} {detail}"
print("tampered=401/未认证 valid_stale=401/签名已过期 (no reminder side effects)")
PY
}

main() {
  case "$PROFILE" in
    local|huawei) ;;
    *)
      echo "unknown PROVIDER_PROFILE='$PROFILE' (expected local or huawei)" >&2
      exit 2
      ;;
  esac

  echo "parity check: profile=$PROFILE base=$BASE_URL started=$(date -Is)"
  preflight

  run_check "health"                 "MAAS_API_KEY"                        -- check_health
  run_check "db_vector_extension"    "RDS_URL"                             -- check_db_extension
  run_check "alembic_single_head"    "RDS_URL"                             -- check_alembic
  run_check "vector_roundtrip"       "RDS_URL"                             -- check_vector_roundtrip
  run_check "embedding_dim"          "MAAS_API_KEY"                        -- check_embedding_dim
  run_check "llm_provider"           "MAAS_API_KEY"                        -- check_llm
  run_check "storage_roundtrip"      "OBS_ENDPOINT OBS_BUCKET OBS_ACCESS_KEY_ID OBS_SECRET_ACCESS_KEY" -- check_storage
  run_check "ocr_health"             "HUAWEI_AK HUAWEI_SK"                 -- check_ocr
  run_check "internal_reminder_sig"  "MAAS_API_KEY"                        -- check_reminder_signature

  local elapsed
  elapsed=$(( $(now_ms) - SCRIPT_START ))
  echo "summary: profile=$PROFILE total=$TOTAL pass=$PASS fail=$FAIL skip=$SKIP elapsed=${elapsed}ms"
  if [ "$FAIL" -gt 0 ]; then
    echo "result: FAIL"
    exit 1
  fi
  if [ "$SKIP" -gt 0 ]; then
    echo "result: BLOCKED (no failures, $SKIP check(s) skipped; exit 3)"
    exit 3
  fi
  echo "result: PASS"
  exit 0
}

main "$@"
