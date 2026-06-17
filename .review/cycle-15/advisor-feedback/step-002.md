---
name: cycle-15-step-002-completion
description: Completion check for cycle-15 People Tagging A — events personIds regression, newPerson.show reset, replaceEventPeople tx rollback
metadata:
  type: feedback
---

# Step 002 — People backend + frontend completion (People Tagging A)

Cycle: 15
Pass: 2
Files Changed: server/src/repositories/people.ts, server/src/routes/people.ts, server/src/routes/events.ts, web/src/InputHub.tsx, web/src/InputHub.test.tsx, server/src/routes/people.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
All verified. Test counts confirm: 19 people integration + 151 integration total + 4 unit, web 26 InputHub (93 web total). Typecheck clean. One efficiency issue flagged.

1. Concern 1 — VALID. POST /api/events tests confirmed in people.integration.test.ts:246 (no-personIds existing behavior, valid attach, 404 for id 8888). 151 integration + 4 unit + 93 web all pass. Pre-validation via findPeopleByIds before createEvent is correct.

2. Concern 2 — VALID. Cancel (InputHub.tsx:388) and success (:208) both reset full literal {show:false,...}. Error path (:210) spreads only submitting/error, keeps show:true. Correct.

3. Concern 3 — VALID. replaceEventPeople delete+insert in one db.transaction (people.ts:47), synchronous better-sqlite3 ROLLBACK on throw. Route pre-validates, so FK path unreachable via API. Untested mid-tx failure acknowledged.

Gaps flagged:
- findPeopleByIds (people.ts:64) is O(n) full-table scan — SELECT * then .filter(ids.includes). Functionally correct, dedupe upstream guards count check, but scales poorly and reads the whole people table per request. inArray(people.id, ids) WHERE clause is the idiomatic fix. Minor, non-blocking.
- Reported file list mismatch: new files (people.ts/people.integration.test.ts) not yet staged. Not a code defect.

No blocking gap. Ship.

## Sonnet Response
- 적용: 세 가지 회귀 우려 모두 PASS로 검증됨. 추가 코드 변경 불필요.
- 무시: findPeopleByIds O(n) full-table scan → inArray 최적화 제안. (이유: non-blocking minor efficiency 항목이고 plan.md Sprint Contract 범위(People Tagging A) 밖. 현재 people 테이블 규모에서 정확성/기능 영향 없음. 다음 cycle 또는 별도 cleanup으로 defer. user intent와 충돌 없음.)
- 참고: "file list mismatch"는 신규 파일이 git에 아직 stage 안 된 상태를 가리킴 — 코드 결함 아님. commit 시점에 포함됨.
