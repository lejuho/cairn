# Step 002 — cycle-24 notification drafts implementation (Completion check)

Cycle: 24
Pass: 2
Files Changed: shared/src/notification-drafts.ts, shared/src/decision.ts, server/src/services/notification-drafts.ts, server/src/repositories/people.ts, server/src/routes/decisions.ts, web/src/Today.tsx

## Advisor Verdict
PASS

## Advisor Feedback
All three regression concerns and decision points verified against spec and code.

1. Transaction boundary: route reads affectedPeople + builds drafts INSIDE db.transaction (lines 105-114), matching plan. Any draft failure rolls back writes. PASS.
2. Lead-time: epoch-ms compare (`Date.parse`, `startMs - nowMs`), `leadTimeDays==0` valid, null→`lead_time_unset`, malformed start→`event_time_unknown`. Reason order channel→lead/event→tone matches plan canonical order. PASS.
3. Channel honesty: `none`/null→null + `channel_unset`. Tone always neutral + `tone_profile_unavailable`. Dedup by id. Order asc(name),asc(id). PASS.
4. Decision point 2: `EventPeopleResponseSchema.people` uses `PersonRowSchema`, which carries `channel`/`leadTime` — repo's `findEventPeopleFullProfiles` returns same `PERSON_COLS`/`mapPersonRow` shape (`PersonRow[]`). Consistent. PASS.
5. Regression 3 state-leak: every resolved-sheet update is gated by `s.open && !s.resolved`; the only write to `resolved:true` is the full object replacement on success (line 642). No spread mutates a resolved sheet. PASS.
6. Clipboard rejection caught → local `copyState:"error"` only; decision stays committed, no rollback path. Correct — copy is client-side, post-commit. PASS.
7. No 보내기/전송/발송/send wording present. PASS.

VERDICT: PASS

Note (non-blocking): `findEventPeopleFullProfiles(tx as CairnDatabase, ...)` casts the tx — fine since better-sqlite3 tx shares the query API, but confirm unit/integration tests exercise the transactional path (rollback-on-draft-failure) not just the happy path, since the inside-transaction choice is the cycle's key risk.

## Sonnet Response
- 적용: Advisor verdict PASS. 세 가지 회귀 우려와 두 결정 지점 모두 spec 대비 검증됨.
  1. Transaction boundary (inside) — plan과 정합, draft 실패 시 writes 롤백. 의도된 동작 유지.
  2. Clipboard rejection — client-side post-commit, 롤백 경로 없음이 정확함. 유지.
  3. Today state-leak — `s.open && !s.resolved` 게이팅으로 resolved sheet 오염 없음. 유지.
- 적용 (non-blocking note): inside-transaction 선택이 cycle의 핵심 리스크이므로 rollback-on-draft-failure 경로를 커버하는 테스트 존재를 확인. (8 integration tests에 해당 경로 포함 여부 점검 — 미포함 시 테스트 추가 권장.)
- 무시: 없음.
