#!/bin/bash
# write-executor-done.sh — Stop hook
# Create executor pass done JSON from an explicit EXECUTOR_DONE marker.
# Fail-open unless a valid marker for an active cycle is present and writing fails.

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$STOP_HOOK_ACTIVE" = "true" ] && exit 0

TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -z "$TRANSCRIPT" ] && exit 0
[ ! -f "$TRANSCRIPT" ] && exit 0

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$GIT_ROOT" ] && exit 0

RECENT=$(tail -c 200000 "$TRANSCRIPT" 2>/dev/null) || exit 0
MARKER=$(printf '%s\n' "$RECENT" | grep -oE '\[\[EXECUTOR_DONE:cycle=[0-9]+ pass=[0-9]+ kind=(implement|fix)\]\]' | tail -1)
[ -z "$MARKER" ] && exit 0

CYCLE=$(printf '%s' "$MARKER" | sed -E 's/.*cycle=([0-9]+).*/\1/')
PASS_RAW=$(printf '%s' "$MARKER" | sed -E 's/.*pass=([0-9]+).*/\1/')
KIND=$(printf '%s' "$MARKER" | sed -E 's/.*kind=(implement|fix).*/\1/')

[ -z "$CYCLE" ] && exit 0
[ -z "$PASS_RAW" ] && exit 0
[ -z "$KIND" ] && exit 0

CYCLE_DIR="$GIT_ROOT/.review/cycle-$CYCLE"
STATUS_FILE="$CYCLE_DIR/status.txt"
[ -d "$CYCLE_DIR" ] || exit 0
[ -f "$STATUS_FILE" ] || exit 0
grep -qx "in_progress" "$STATUS_FILE" 2>/dev/null || exit 0

PASS_NUM=$((10#$PASS_RAW))
PASS_PAD=$(printf "%03d" "$PASS_NUM")
DONE_DIR="$CYCLE_DIR/executor"
DONE_PATH="$DONE_DIR/pass-${PASS_PAD}-done.json"
[ -f "$DONE_PATH" ] && exit 0

REVIEW_REL=""
if [ "$KIND" = "fix" ]; then
  LATEST_REVIEW=$(find "$CYCLE_DIR" -maxdepth 1 -name 'review-v*.md' -type f 2>/dev/null | sort -V | tail -1)
  if [ -n "$LATEST_REVIEW" ]; then
    REVIEW_REL=${LATEST_REVIEW#"$GIT_ROOT/"}
  fi
fi

mkdir -p "$DONE_DIR" 2>/dev/null || {
  cat <<EOF
{
  "decision": "block",
  "reason": "EXECUTOR_DONE marker found, but could not create done directory: ${DONE_DIR}"
}
EOF
  exit 0
}

CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_PATH="$DONE_PATH.tmp.$$"

if jq -n \
  --argjson cycle "$CYCLE" \
  --argjson pass "$PASS_NUM" \
  --arg kind "$KIND" \
  --arg review "$REVIEW_REL" \
  --arg createdAt "$CREATED_AT" \
  --arg summary "Created by Claude Stop hook from EXECUTOR_DONE marker." \
  --arg generatedBy ".claude/hooks/write-executor-done.sh" \
  '{
    cycle: $cycle,
    pass: $pass,
    kind: $kind,
    review: (if $review == "" then null else $review end),
    createdAt: $createdAt,
    summary: $summary,
    checks: [],
    generatedBy: $generatedBy
  }' > "$TMP_PATH" 2>/dev/null && mv "$TMP_PATH" "$DONE_PATH" 2>/dev/null; then
  exit 0
fi

rm -f "$TMP_PATH" 2>/dev/null
cat <<EOF
{
  "decision": "block",
  "reason": "EXECUTOR_DONE marker found, but could not write ${DONE_PATH}. Create the executor done file manually before stopping."
}
EOF
