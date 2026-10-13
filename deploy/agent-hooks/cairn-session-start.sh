#!/usr/bin/env bash
# Claude Code SessionStart 훅: 현재 cwd 와 관련된 Cairn inbox 질문을 세션 컨텍스트에 주입한다.
# 실패해도 세션을 막지 않는다 (항상 exit 0, 출력 없으면 아무 일도 안 함).
set -u
CAIRN="${CAIRN_API_BASE_URL:-http://127.0.0.1:3100}"

# claude -p 같은 비대화형 배치 세션에는 주입하지 않는다.
[ "${CLAUDE_CODE_ENTRYPOINT:-cli}" = "cli" ] || exit 0
[ "${CLAUDE_CODE_SESSION_ATTENDED:-1}" = "1" ] || exit 0
command -v jq >/dev/null || exit 0

input=$(cat)
source=$(jq -r '.source // "startup"' <<<"$input" 2>/dev/null)
case "$source" in startup|clear) ;; *) exit 0 ;; esac
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
cwd=${cwd:-$PWD}

resp=$(curl -fsS -m 2 -G "$CAIRN/api/inbox" --data-urlencode "cwd=$cwd" --data-urlencode "limit=3" 2>/dev/null) || exit 0
total=$(jq -r '.data.pendingTotal // 0' <<<"$resp" 2>/dev/null)
[ "${total:-0}" -gt 0 ] 2>/dev/null || exit 0

lines=$(jq -r '.data.items[] | "- [#\(.id) \(.kind)\(if .relevance == "workspace" then ", 이 작업 관련" else "" end)] \(.prompt)  (답 기록: \(.answerHint))"' <<<"$resp")

ctx="Cairn(사용자의 일정/맥락 허브)에 확인 대기 질문이 ${total}개 있습니다. 상위 항목:
${lines}

지침: 사용자의 현재 요청을 먼저 처리하세요. 작업 흐름을 끊지 않는 시점(첫 응답 끝이나 작업이 일단락됐을 때)에 가장 관련 있는 질문 1개만 짧게 물어보세요. 사용자가 답하면 MCP 도구 cairn_confirm(id, decision, value, note, answeredBy=\"claude-code\")으로 기록하고, 답하지 않거나 무시하면 다시 묻지 마세요. 추측으로 accept 하지 마세요."

jq -n --arg ctx "$ctx" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
