# Step 002 — Navigation + Input Hub implementation (Completion check)

Cycle: 14
Pass: 2
Files Changed:
- web/src/AppNav.tsx (new)
- web/src/App.tsx
- web/src/InputHub.tsx (new)
- web/src/Today.tsx
- web/src/styles.css
- web/src/App.test.tsx
- web/src/InputHub.test.tsx (new)
- docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All three concerns verified.

**Concern 1 — "/"→"/today" redirect & aria-current ordering**
- App.tsx:20-22 — `path==="/"` branch hardcodes `<AppNav path="/today" />`, so aria-current is set correctly even before replaceState resolves. No reliance on the effect.
- AppNav.tsx:16 also has belt-and-suspenders fallback `(href==="/today" && path==="/")`.
- replaceState (App.tsx:12-16) is a separate effect that only rewrites the URL bar; render path uses the memoized `path` (line 10). No race: render is correct regardless of effect timing. Test App.test.tsx:38-45,70-74 confirms both redirect and aria-current. OK.

**Concern 2 — Today quiet `/input` link**
- Today.tsx:488-495 — CTA button (`today-add-btn--cta`, opens sheet) and the new `<a href="/input">` link (line 495) are distinct elements with different roles/labels; no selector collision. Quiet test keys on `getByTestId("today-quiet")` (App.test.tsx:45), not link/button counts, so it still passes. No quiet test asserts absence of the link. OK.

**Concern 3 — slot candidates timezone correctness**
- Refuted as a bug. Client sends `now` as UTC `...+00:00` (InputHub.tsx:33-35, Today.tsx:226). Server slotCandidates.ts:34 derives `offset` from the `now` string itself via `extractOffset`, then builds candidate wall-clock times in that same offset (line 42) and compares via epoch-ms `rfc3339ToMs` (line 45). Since client always sends `+00:00`, candidate hours (9/11/14/16/19) are generated in UTC — internally consistent and timezone-safe for comparison. Correct, but note: WINDOW_HOURS are interpreted in the offset of `now`, which is always UTC here, so suggested slots are 9:00–19:00 UTC, not the user's local working hours. A KST user gets candidates at 18:00–04:00 local. Not a regression (consistent with cycle-13's UTC `now`), but a product-correctness smell worth a follow-up.

Verdict:
- Concern 1: safe, no race.
- Concern 2: no conflict, tests pass.
- Concern 3: no epoch/comparison bug; slots are internally consistent but anchored to UTC working hours (pre-existing design, not introduced here).

PASS

## Sonnet Response
- 적용: Concern 1, 2 — 추가 조치 불필요. Advisor가 render path / replaceState 분리와 testid 기반 quiet 테스트로 안전성 확인. 현행 유지.
- 적용: Concern 3 — epoch 비교/타임존 버그 없음 확인. 현 cycle 범위 내 회귀 아님.
- 무시: Concern 3의 "UTC working-hours 앵커" follow-up 제안 — 이유: cycle-13에서 결정된 UTC `now` 설계와 정합하는 pre-existing 동작이며, 슬롯 윈도우의 로컬 타임존 정렬은 plan.md cycle-14 Sprint Contract(Navigation + Input Hub) 범위 밖. 본 cycle에서 수정하면 scope 확장. 다음 cycle 후보로 기록.
