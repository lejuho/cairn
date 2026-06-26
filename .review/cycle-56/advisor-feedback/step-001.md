# Step 001 — Approach review: Thread Resume STAR Save/Edit A (cycle-56)

Cycle: 56
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
APPROVE (with one correction)

## Advisor Feedback
1. Migration — OK. db:generate will emit a table-REBUILD (threads has a table-level check()); hand-replace with 5 `ALTER TABLE threads ADD COLUMN` per cycle-44 (0004). Column-inline `CONSTRAINT ... CHECK(resume_relevant in (0,1))` avoids the rebuild. Verify on temp SQLite via integration test.
2. Partial-update — OK. `'key' in patch` matches tasks.ts:51 / events.ts:140 precedent. resumeRelevant:false never clears STAR text; blank→null; skillsTags replaces whole array.
3. parseSkillsTags fail-open — OK. JSON.parse in try/catch, [] on non-array/non-string; getThreadDetail via findThreadResume stays crash-safe.
4. Dedicated findThreadResume — OK. findThreadById is select-all so new cols land at runtime but are dropped by the ThreadRow cast in TS; a dedicated read keeps ThreadRow stable. Don't widen ThreadRow.
5. Route scope — OK WITH CORRECTION: routes register directly via `app.patch` in threads.ts (db closure-captured), NOT an `if(db)` block; gateway only goes to star-draft. Register alongside node-links confirm; do NOT pass gateway. Envelope `{ok:false,error:{code,message}}` / `{ok:true,data}`. Writes only 5 resume cols; star-draft stays ephemeral.

## Sonnet Response
- 적용: 1 — schema에 5컬럼 + table check 추가 후 db:generate, table-rebuild면 5 ALTER ADD COLUMN(resume_relevant 인라인 CONSTRAINT CHECK)로 수동 교체, integration으로 적용 검증
- 적용: 2 — `'key' in patch`로 set 구성(미지정 필드 보존), text trim+blank→null, skillsTags 전체 치환
- 적용: 3 — parseSkillsTags JSON.parse try/catch, 배열·문자열 아니면 [] (fail-open)
- 적용: 4 — findThreadResume 전용 read, ThreadRow 미확장
- 적용(정정): 5 — registerThreadRoutes 안에서 app.patch로 등록(db만, gateway 없음), resume 5컬럼만 mutate, star-draft 비영속 유지
- 무시: 없음
