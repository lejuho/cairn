#!/bin/bash
# PreToolUse(Bash): deny destructive commands. Invalid input fails open.

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

PATTERNS=(
  'rm[[:space:]]+-rf[[:space:]]+[/~*]'
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+DATABASE'
  'TRUNCATE[[:space:]]+TABLE'
  'dd[[:space:]].*of=/dev/'
  'mkfs\.'
  'git[[:space:]]+push[[:space:]].*--force[^-].*\b(main|master)\b'
  'git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+HEAD([^~]|$)'
)

for pattern in "${PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qiE "$pattern" 2>/dev/null; then
    REASON="Destructive command blocked by repository hook (pattern: ${pattern}). Ask the user for explicit confirmation and use a narrower operation."
    jq -n \
      --arg reason "$REASON" \
      '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
    exit 0
  fi
done

exit 0
