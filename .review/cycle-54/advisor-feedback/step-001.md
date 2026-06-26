# Step 001 — Approach review: Thread Missing Node Suggestions A (cycle-54)

Cycle: 54
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Repo: 3 read-only title helpers — sound; slim reads omit title so necessary. Keep them pure SELECTs, direct threadId only.
2. evidenceThreadCount==evidenceNodeCount: forced equal by per-thread collapse, so the two fields are redundant in this slice. Acceptable, justify; they'd differ only if later counting repeats-per-thread — don't add now.
3. Cross-kind suppression: matches plan edge case. OK.
4. Eligibility gates: correct; direct-only, no descendants, done-only, blank-skip — deterministic.
5. Sort+limit 5, as-written title, no start/end/due/order/sequence/score: within no-speculation intent.
Caution: id `missing-node:${kind}:${normTitle}` can hold `:` if title has it; namespace-safe but confirm no downstream parse.

## Sonnet Response
- 적용: 1 — findCompletedThreadsByKind + findEvent/TaskTitlesByThreadIds (pure SELECT, direct threadId); getThreadDetail가 eligibility 가드 후 evidence read
- 적용: 2 — (nodeKind, normalizedTitle) 키, per-thread collapse로 두 count 동일(이 slice 한정, repeats-per-thread 미도입). spec의 두 필드 유지
- 적용: 3 — suppress는 normalizedTitle로 event/task 양쪽 횡단
- 적용: 4 — current kind 비어있지 않고 status∉{done,dropped}; evidence는 done+exact kind+id≠current; 노드는 direct done, blank 무시
- 적용: 5 — (evidenceThreadCount desc, evidenceNodeCount desc, title asc, nodeKind asc) 정렬, limit 5, as-written title, date/order/sequence/score 미복사
- 확인: id는 normTitle 전체 append라 distinct 보장, opaque key(파싱 없음) — 충돌/파싱 위험 없음
- 무시: 없음
