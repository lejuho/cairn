# Step 004 — review-v1 fixes for Ego Graph A (4 issues)

Cycle: 40
Pass: 4
Files Changed: (pending) ego graph repository (resource center), Thread EgoSheet, PersonDetail ego UI, relations.ts

## Advisor Verdict
PASS

## Advisor Feedback
ISSUE-1 (thread_link edges):
1. (a) Yes — scoping `thread_links` query to already-collected linked-thread-id set stays A-slice; no global traversal. Consistent.
2. Require BOTH endpoints ∈ set (intra-neighborhood only); avoids pulling new nodes.
3. (b) Yes — hard|soft maps 1:1 to EgoGraphFirmness. OK.
4. Emit all candidates; rely on builder's post-cap endpoint filter. Confirm builder drops dangling edges (don't assume — verify).
5. Set `relationKind: kind`; dedupe symmetric pairs if undirected.

ISSUE-2 (bottom sheet):
6. (c) Reuse, not over-engineering — read-only still needs dialog/escape/focus-return for parity + a11y.
7. Mirror existing profile-edit sentinel focus-trap; share sheet-backdrop/bottom-sheet CSS.
8. Save initial-focus ref; return focus to opener on close.

ISSUE-3: Render `edge.reason` after `[firmness]`; omit when empty/null.

ISSUE-4: Strip trailing blank line.

Order: 4→1→3→2. Verify builder truncation filter before emitting.

## Sonnet Response
- 적용: ISSUE-1 both-endpoints-in-set scoping, firmness 1:1 map, emit-all-candidates + verify builder truncation filter before relying on it, relationKind:kind, dedupe symmetric pairs. ISSUE-2 reuse existing sentinel focus-trap + sheet CSS for both ego sheets, return focus to opener. ISSUE-3 reason after [firmness], omit when empty. ISSUE-4 strip trailing blank line. Implementation order 4→1→3→2.
- 무시: 없음 (모든 권고가 plan.md 및 review-v1 issue와 정합).
