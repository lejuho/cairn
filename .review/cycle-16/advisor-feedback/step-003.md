# Step 003 — cycle-16 review-v1 fixes (3 issues)

Cycle: 16
Pass: 4
Files Changed: web/src/Today.tsx, web/src/Today.test.tsx, server/src/repositories/people.ts, server/src/__tests__/events.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
- ISSUE-1: save → await detail refetch → `refresh()` (sequential, not parallel) so detail confirms persistence before surface refetch.
- ISSUE-2: make only the title tappable (button/role), NOT whole card; keep needs_review reply form + schedule_prompt slot buttons as separate, independent click targets. Prefer non-nested sibling layout; use stopPropagation only if nesting forces it.
- ISSUE-3: `orderBy(asc(people.name), asc(people.id))` — name ASC primary, id ASC tiebreaker. Test: insert 3+ people unsorted, assert returned order matches name-sorted.

## Sonnet Response
- 적용: All three as advised. ISSUE-1 sequential detail-then-Today refetch. ISSUE-2 title-only tappable element preserving existing interactive children. ISSUE-3 orderBy name/id + multi-person sorted integration test.
- 무시: none
