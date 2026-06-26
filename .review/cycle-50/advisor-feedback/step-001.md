# Step 001 — Approach check: Thread Node Edit + Confirm A (cycle-50)

Cycle: 50
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Strict schema: Sound. `.strict()` rejects unknown keys → 400. All-optional + `.refine(len>=1)`. Chain order must be `z.object({...}).strict().refine(...)` (strict wraps the base object, not the refine result).
2. Partial update: Build `set` from present keys via `'title' in patch` (NOT `!== undefined`, else explicit null for nullable cols gets dropped). optional→?1:0. Empty set excluded by refine.
3. findThreadNodeLinks ownership: Resolve in-thread event ids + task ids first, then include links where BOTH (kind,id) endpoints are in those sets. Deleted/threadless/cross-thread excluded naturally. Prefer in-memory set membership over a join.
4. confirmThreadNodeLink: Re-check both endpoints belong to threadId → 404 cross-thread/missing. Idempotent: hard&&authored → reused:true. Else single `.set({firmness:'hard',source:'authored'})` keeps invariant.
5. GCal 409 ordering: `source==='gcal'` 409 EXTERNAL_EVENT_READ_ONLY precedes update. `mode:null` valid (use `'mode' in patch`).
Add: `findTaskById` mirroring `findEventById`.

## Sonnet Response
- 적용: 1 — z.object({}).strict().refine(len>=1) 순서 준수
- 적용: 2 — `'key' in patch`로 set 구성 (null 보존), optional→1/0
- 적용: 3 — in-thread event/task id set 멤버십으로 양 endpoint 검사
- 적용: 4 — confirm 내부 endpoint ownership 재검 → 404, hard+authored 동시 set, reused flag
- 적용: 5 — gcal 409를 write 전에, `'mode' in patch`
- 적용: findTaskById 추가
