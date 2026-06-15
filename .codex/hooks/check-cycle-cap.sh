#!/bin/bash
# Stop: enforce the issue-velocity cap for the active review cycle.
# Invalid input, missing files, and sessions outside a cycle fail open.

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

STOP_HOOK_ACTIVE=$(printf '%s' "$INPUT" |
  jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$STOP_HOOK_ACTIVE" = "true" ] && exit 0

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$GIT_ROOT" ] && exit 0

REVIEW_DIR="$GIT_ROOT/.review"
[ ! -d "$REVIEW_DIR" ] && exit 0

CURRENT_CYCLE=""
for status_file in "$REVIEW_DIR"/cycle-*/status.txt; do
  [ ! -f "$status_file" ] && continue
  if grep -qx "in_progress" "$status_file" 2>/dev/null; then
    CURRENT_CYCLE=$(dirname "$status_file")
    break
  fi
done
[ -z "$CURRENT_CYCLE" ] && exit 0

REVIEW_FILES=$(find "$CURRENT_CYCLE" -maxdepth 1 \
  -name 'review-v*.md' -type f 2>/dev/null | sort -V)
[ -z "$REVIEW_FILES" ] && exit 0

REVIEW_COUNT=$(printf '%s\n' "$REVIEW_FILES" | wc -l | tr -d ' ')
STAGNATION_LIMIT=${CYCLE_STAGNATION_LIMIT:-3}
VELOCITY_PASS_WINDOW=${CYCLE_VELOCITY_PASS_WINDOW:-5}
VELOCITY_ISSUE_LIMIT=${CYCLE_VELOCITY_ISSUE_LIMIT:-3}

STAGNANT_ISSUE=""
if [ "$REVIEW_COUNT" -ge "$STAGNATION_LIMIT" ]; then
  COMMON_UNRESOLVED=""
  FIRST=true

  while IFS= read -r review_file; do
    [ -z "$review_file" ] && continue
    CURRENT=$(grep -oE \
      'ISSUE-[0-9]+:[[:space:]]*(UNRESOLVED|REGRESSION)' \
      "$review_file" 2>/dev/null |
      grep -oE 'ISSUE-[0-9]+' |
      sort -u)

    if [ "$FIRST" = "true" ]; then
      COMMON_UNRESOLVED="$CURRENT"
      FIRST=false
    else
      COMMON_UNRESOLVED=$(comm -12 \
        <(printf '%s\n' "$COMMON_UNRESOLVED") \
        <(printf '%s\n' "$CURRENT") 2>/dev/null)
    fi

    [ -z "$COMMON_UNRESOLVED" ] && break
  done <<< "$(printf '%s\n' "$REVIEW_FILES" | tail -n "$STAGNATION_LIMIT")"

  if [ -n "$COMMON_UNRESOLVED" ]; then
    STAGNANT_ISSUE=$(printf '%s\n' "$COMMON_UNRESOLVED" | head -1)
  fi
fi

NEW_ISSUE_COUNT=0
NEW_ISSUE_LIST=""
if [ "$REVIEW_COUNT" -ge "$VELOCITY_PASS_WINDOW" ]; then
  PREV_COUNT=$((REVIEW_COUNT - VELOCITY_PASS_WINDOW))
  PREV_ISSUES=""

  if [ "$PREV_COUNT" -gt 0 ]; then
    while IFS= read -r review_file; do
      [ -z "$review_file" ] && continue
      IDS=$(grep -oE '### ISSUE-[0-9]+' "$review_file" 2>/dev/null |
        grep -oE 'ISSUE-[0-9]+')
      PREV_ISSUES=$(printf '%s\n%s' "$PREV_ISSUES" "$IDS")
    done <<< "$(printf '%s\n' "$REVIEW_FILES" | head -n "$PREV_COUNT")"
    PREV_ISSUES=$(printf '%s\n' "$PREV_ISSUES" |
      sort -u |
      grep -v '^$')
  fi

  RECENT_ISSUES=""
  while IFS= read -r review_file; do
    [ -z "$review_file" ] && continue
    IDS=$(grep -oE '### ISSUE-[0-9]+' "$review_file" 2>/dev/null |
      grep -oE 'ISSUE-[0-9]+')
    RECENT_ISSUES=$(printf '%s\n%s' "$RECENT_ISSUES" "$IDS")
  done <<< "$(printf '%s\n' "$REVIEW_FILES" | tail -n "$VELOCITY_PASS_WINDOW")"
  RECENT_ISSUES=$(printf '%s\n' "$RECENT_ISSUES" |
    sort -u |
    grep -v '^$')

  if [ -n "$RECENT_ISSUES" ]; then
    if [ -n "$PREV_ISSUES" ]; then
      NEW_ISSUE_LIST=$(comm -23 \
        <(printf '%s\n' "$RECENT_ISSUES") \
        <(printf '%s\n' "$PREV_ISSUES") 2>/dev/null)
    else
      NEW_ISSUE_LIST="$RECENT_ISSUES"
    fi
    NEW_ISSUE_COUNT=$(printf '%s\n' "$NEW_ISSUE_LIST" |
      grep -c '^ISSUE-' 2>/dev/null)
    NEW_ISSUE_COUNT=${NEW_ISSUE_COUNT:-0}
  fi
fi

TRIGGER_REASON=""
if [ -n "$STAGNANT_ISSUE" ]; then
  TRIGGER_REASON="Same-Issue Stagnation: ${STAGNANT_ISSUE} remained unresolved in the latest ${STAGNATION_LIMIT} reviews. Escalate for a plan amendment or a different approach."
elif [ "$NEW_ISSUE_COUNT" -ge "$VELOCITY_ISSUE_LIMIT" ]; then
  ISSUE_LIST=$(printf '%s\n' "$NEW_ISSUE_LIST" |
    tr '\n' ' ' |
    sed 's/[[:space:]]*$//')
  TRIGGER_REASON="New-Issue Velocity: ${NEW_ISSUE_COUNT} new issues appeared in the latest ${VELOCITY_PASS_WINDOW} reviews (${ISSUE_LIST}). Escalate for replanning or cycle split."
fi

[ -z "$TRIGGER_REASON" ] && exit 0

printf '%s\n' "escalated" > "$CURRENT_CYCLE/status.txt"
jq -n \
  --arg reason "Issue-velocity cap triggered; status.txt is now escalated. ${TRIGGER_REASON}" \
  '{decision: "block", reason: $reason}'
