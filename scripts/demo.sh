#!/usr/bin/env bash
# Eight-stage end-to-end smoke test against the live API.
#
# Requires: backend on $BASE_URL with LLM_PROVIDER=mock / EMBEDDING_PROVIDER=mock,
# the demo account seeded (scripts/seed_demo.py) and fixtures/lec01.pdf present.
# Uses curl + python3 only (jq is optional and auto-detected).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@example.com}"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo1234}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="${FIXTURES_DIR:-$ROOT_DIR/fixtures}"
PDF="$FIXTURES_DIR/lec01.pdf"
STARTED_AT=$SECONDS

if command -v jq >/dev/null 2>&1; then
  HAVE_JQ=1
else
  HAVE_JQ=0
fi

jget() {
  # jget '<jq filter>' '<python expression over d>'
  if [ "$HAVE_JQ" = "1" ]; then
    jq -r "$1"
  else
    python3 -c "import json,sys; d=json.load(sys.stdin); print($2)"
  fi
}

fail() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

step() {
  printf '✓ %s (%ss)\n' "$1" "$((SECONDS - STARTED_AT))"
}

trap 'fail "第 $STEP 阶段失败（耗时 $((SECONDS - STARTED_AT))s）"' ERR

STEP=0
STEP=$((STEP + 1))
for _ in $(seq 1 60); do
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$BASE_URL/api/health" >/dev/null || fail "后端未就绪：$BASE_URL/api/health"
[ -f "$PDF" ] || fail "缺少 fixtures/lec01.pdf，请先运行 scripts/seed_demo.py --make-fixtures"

LOGIN_JSON="$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")" \
  || fail "登录失败：请先运行 scripts/seed_demo.py"
TOKEN="$(printf '%s' "$LOGIN_JSON" | jget '.access_token' 'd["access_token"]')"
AUTH="Authorization: Bearer $TOKEN"

# --- 1/8 upload -------------------------------------------------------------
STEP=1
UPLOAD_JSON="$(curl -fsS -X POST "$BASE_URL/api/sources/upload" \
  -H "$AUTH" -F "file=@$PDF;type=application/pdf")"
SOURCE_ID="$(printf '%s' "$UPLOAD_JSON" | jget '.source_id' 'd["source_id"]')"
JOB_ID="$(printf '%s' "$UPLOAD_JSON" | jget '.job_id' 'd["job_id"]')"

JOB_STATUS=queued
for _ in $(seq 1 240); do
  JOB_JSON="$(curl -fsS "$BASE_URL/api/jobs/$JOB_ID" -H "$AUTH")"
  JOB_STATUS="$(printf '%s' "$JOB_JSON" | jget '.status' 'd["status"]')"
  case "$JOB_STATUS" in
    ready) break ;;
    failed) fail "解析失败：$(printf '%s' "$JOB_JSON" | jget '.error_message' 'd["error_message"]')" ;;
  esac
  sleep 0.5
done
[ "$JOB_STATUS" = "ready" ] || fail "解析超时（状态 $JOB_STATUS）"
step "1/8 上传 $PDF → job ready"

# --- 2/8 notes --------------------------------------------------------------
STEP=2
NOTES_JSON="$(curl -fsS -X POST "$BASE_URL/api/sources/$SOURCE_ID/notes" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')"
KP_CREATED="$(printf '%s' "$NOTES_JSON" | jget '.knowledge_points_created' 'd["knowledge_points_created"]')"
[ "$KP_CREATED" -ge 3 ] || fail "知识点不足：$KP_CREATED"
step "2/8 生成笔记树 → $KP_CREATED 个知识点"

# --- 3/8 tree ---------------------------------------------------------------
STEP=3
TREE_JSON="$(curl -fsS "$BASE_URL/api/sources/$SOURCE_ID/tree" -H "$AUTH")"
TREE_NODES="$(printf '%s' "$TREE_JSON" | python3 -c '
import json, sys

def count(nodes):
    return sum(1 + count(node.get("children") or []) for node in nodes)

print(count(json.load(sys.stdin)))
')"
KP_ID="$(printf '%s' "$TREE_JSON" | python3 -c 'import json, sys; print(json.load(sys.stdin)[0]["id"])')"
[ "$TREE_NODES" -ge 3 ] || fail "树节点不足：$TREE_NODES"
step "3/8 导图接口 → $TREE_NODES 个节点"

# --- 4/8 quiz ---------------------------------------------------------------
STEP=4
QUIZ_JSON="$(curl -fsS -X POST "$BASE_URL/api/quiz/generate" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"knowledge_point_ids\":[\"$KP_ID\"],\"type\":\"choice\",\"num\":3}")"
QUIZ_COUNT="$(printf '%s' "$QUIZ_JSON" | jget '.created | length' 'len(d["created"])')"
[ "$QUIZ_COUNT" -eq 3 ] || fail "出题数量异常：$QUIZ_COUNT"
QUIZ_MODEL="$(printf '%s' "$QUIZ_JSON" | jget '.model' 'd["model"]')"
step "4/8 生成 3 道选择题 → model=$QUIZ_MODEL"

# --- 5/8 answer wrong -------------------------------------------------------
STEP=5
WRONG_JSON="$(
  printf '%s' "$QUIZ_JSON" | python3 -c '
import json, sys

data = json.load(sys.stdin)
print(json.dumps([{"id": item["id"], "answer": item["answer"]} for item in data["created"]]))
'
)"
CARDS_CREATED=0
CHUNKS=0
QUESTION_COUNT=0
while IFS=$'\t' read -r QID CORRECT; do
  QUESTION_COUNT=$((QUESTION_COUNT + 1))
  case "$CORRECT" in
    A) WRONG=B ;;
    B) WRONG=A ;;
    C) WRONG=A ;;
    *) WRONG=A ;;
  esac
  ANSWER_JSON="$(curl -fsS -X POST "$BASE_URL/api/quiz/$QID/answer" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"answer\":\"$WRONG\",\"response_time_ms\":1200}")"
  CARD="$(printf '%s' "$ANSWER_JSON" | jget '.card_created' 'd["card_created"]')"
  CHUNK="$(printf '%s' "$ANSWER_JSON" | jget '.source_chunk != null' 'd["source_chunk"] is not None')"
  if [ "$CARD" = "True" ] || [ "$CARD" = "true" ]; then CARDS_CREATED=$((CARDS_CREATED + 1)); fi
  if [ "$CHUNK" = "True" ] || [ "$CHUNK" = "true" ]; then CHUNKS=$((CHUNKS + 1)); fi
done < <(printf '%s' "$WRONG_JSON" | python3 -c '
import json, sys
for item in json.load(sys.stdin):
    print(item["id"] + "\t" + item["answer"])
')
[ "$CARDS_CREATED" -ge 1 ] || fail "答错后未创建复习卡片"
[ "$CHUNKS" -ge 1 ] || fail "答错后未返回 source_chunk"
step "5/8 答错 $QUESTION_COUNT 题 → 卡片 $CARDS_CREATED，出处 $CHUNKS"

# --- 6/8 review -------------------------------------------------------------
STEP=6
DUE_JSON="$(curl -fsS "$BASE_URL/api/review/due" -H "$AUTH")"
DUE_COUNT="$(printf '%s' "$DUE_JSON" | jget '.count' 'd["count"]')"
[ "$DUE_COUNT" -ge 1 ] || fail "没有到期复习卡片：$DUE_COUNT"
CARD_ID="$(printf '%s' "$DUE_JSON" | jget '.cards[0].id' 'd["cards"][0]["id"]')"
SUBMIT_JSON="$(curl -fsS -X POST "$BASE_URL/api/review/$CARD_ID/submit" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"rating":4}')"
NEXT_DUE="$(printf '%s' "$SUBMIT_JSON" | jget '.next_due_date' 'd["next_due_date"]')"
TODAY="$(python3 -c 'from datetime import datetime; from zoneinfo import ZoneInfo; print(datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat())')"
[ "$NEXT_DUE" \> "$TODAY" ] || fail "评分后到期日未更新：$NEXT_DUE"
step "6/8 复习提交 rating=4 → 下次 $NEXT_DUE（今天 $TODAY）"

# --- 7/8 dashboard ----------------------------------------------------------
STEP=7
DASH_JSON="$(curl -fsS "$BASE_URL/api/dashboard/summary" -H "$AUTH")"
DASH_DUE="$(printf '%s' "$DASH_JSON" | jget '.due_count' 'd["due_count"]')"
RADAR_SIZE="$(printf '%s' "$DASH_JSON" | jget '.mastery_radar | length' 'len(d["mastery_radar"])')"
[ "$DASH_DUE" -ge 1 ] || fail "仪表盘 due_count 为 0"
[ "$RADAR_SIZE" -ge 1 ] || fail "仪表盘 mastery_radar 为空"
step "7/8 仪表盘 → due=$DASH_DUE，雷达 $RADAR_SIZE 项"

# --- 8/8 explain SSE --------------------------------------------------------
STEP=8
SSE_OUT="$(curl -sS -N -X POST "$BASE_URL/api/knowledge-points/$KP_ID/explain" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"style":"concise"}')"
TOKEN_FRAMES="$(printf '%s' "$SSE_OUT" | grep -c '^event: token' || true)"
DONE_FRAMES="$(printf '%s' "$SSE_OUT" | grep -c '^event: done' || true)"
[ "$TOKEN_FRAMES" -ge 5 ] || fail "SSE token 帧不足：$TOKEN_FRAMES"
[ "$DONE_FRAMES" -ge 1 ] || fail "SSE 缺少 done 帧"
if printf '%s' "$SSE_OUT" | grep -q '^event: error'; then
  fail "SSE 返回错误帧"
fi
step "8/8 Agent 讲解 → $TOKEN_FRAMES 个 token 帧 + done"

printf '全部 8 个阶段通过，总耗时 %ss\n' "$((SECONDS - STARTED_AT))"
