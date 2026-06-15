#!/bin/bash
# PostToolUse(Bash): on the second identical error signature, force a new approach.
# Invalid or unknown tool output fails open.

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$TOOL_NAME" != "Bash" ] && exit 0

# Codex's Bash response shape may evolve. Search scalar response fields instead
# of depending on one unstable nested key.
RESPONSE_TEXT=$(printf '%s' "$INPUT" | jq -r '
  .tool_response
  | .. | scalars
  | select(type == "string")
' 2>/dev/null)
[ -z "$RESPONSE_TEXT" ] && exit 0

ERROR_LINE=$(printf '%s\n' "$RESPONSE_TEXT" |
  grep -E '(Error|Exception|FAILED|Traceback|error:|TypeError|ValueError|ImportError)' |
  head -1)
[ -z "$ERROR_LINE" ] && exit 0

ERROR_SIG=$(printf '%s' "$ERROR_LINE" |
  sed 's/[[:space:]]\{1,\}/ /g; s/^ //; s/ $//' |
  cut -c1-200)
[ -z "$ERROR_SIG" ] && exit 0

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$GIT_ROOT" ] && exit 0

PROJECT_NAME=$(basename "$GIT_ROOT")
FAILURE_LOG="${TMPDIR:-/tmp}/codex-failures-${PROJECT_NAME}.log"
MATCH_COUNT=0

if [ -f "$FAILURE_LOG" ]; then
  MATCH_COUNT=$(grep -Fxc "$ERROR_SIG" "$FAILURE_LOG" 2>/dev/null)
  MATCH_COUNT=${MATCH_COUNT:-0}
fi

if [ "$MATCH_COUNT" -ge 1 ]; then
  REASON="2-strike Andon: the same error signature occurred twice. Do not retry the same approach. Reassess the root cause or use an Advisor/subagent. Error: ${ERROR_SIG}"
  jq -n \
    --arg reason "$REASON" \
    '{
      decision: "block",
      reason: $reason,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: $reason
      }
    }'
  exit 0
fi

printf '%s\n' "$ERROR_SIG" >> "$FAILURE_LOG"
exit 0
