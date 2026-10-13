#!/usr/bin/env bash
# Claude Code SessionEnd 훅: 대화형 세션의 흔적(cwd, 첫 요청, 턴 수)을 Cairn observation 으로 남긴다.
# 추출 배치가 이걸로 "이 디렉터리는 어느 thread 일인가" 같은 질문을 만든다. 항상 exit 0.
set -u
CAIRN="${CAIRN_API_BASE_URL:-http://127.0.0.1:3100}"
TOKEN_FILE="${CAIRN_INGEST_TOKEN_FILE:-$HOME/.config/cairn/ingest-token}"

[ "${CLAUDE_CODE_ENTRYPOINT:-cli}" = "cli" ] || exit 0
[ "${CLAUDE_CODE_SESSION_ATTENDED:-1}" = "1" ] || exit 0
command -v jq >/dev/null || exit 0

input=$(cat)
session_id=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
transcript=$(jq -r '.transcript_path // empty' <<<"$input" 2>/dev/null)
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
reason=$(jq -r '.reason // empty' <<<"$input" 2>/dev/null)
[ -n "$session_id" ] && [ -f "$transcript" ] || exit 0

# 사람이 직접 친 프롬프트만 (tool_result 는 content 가 배열이라 제외됨).
prompts=$(jq -r 'select(.type == "user" and (.message.content | type) == "string" and (.isMeta | not)) | .message.content' "$transcript" 2>/dev/null \
  | grep -v '^<' | grep -v '^\s*$')
turns=$(jq -c 'select(.type == "user" and (.message.content | type) == "string" and (.isMeta | not))' "$transcript" 2>/dev/null | wc -l)
[ "${turns:-0}" -gt 0 ] || exit 0
first=$(head -c 300 <<<"$prompts" | head -n 3)
last=$(tail -n 1 <<<"$prompts" | head -c 300)
started=$(jq -r 'select(.timestamp) | .timestamp' "$transcript" 2>/dev/null | head -n 1)

body=$(jq -n --arg sid "$session_id" --arg cwd "${cwd:-$PWD}" --arg first "$first" --arg last "$last" \
  --arg reason "$reason" --argjson turns "$turns" --arg started "$started" '{
    source: "claude_session", sourceRef: $sid, app: "claude-code", cwd: $cwd,
    title: $first, meta: {turns: $turns, reason: $reason}
  } + (if $last != "" and $last != $first then {body: $last} else {} end) + (if $started != "" then {occurredAt: $started} else {} end)')

token=$(cat "$TOKEN_FILE" 2>/dev/null)
curl -fsS -m 3 -X POST "$CAIRN/api/observations" -H 'content-type: application/json' \
  ${token:+-H "authorization: Bearer $token"} -d "$body" >/dev/null 2>&1 || true
exit 0
