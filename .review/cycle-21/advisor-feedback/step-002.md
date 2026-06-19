# Step 002 — cycle-21 completion check: People Guard A 구현 (frontend constraint/conflict sheet)

Cycle: 21
Pass: 2
Files Changed: web/src/InputHub.tsx, web/src/Today.tsx, web/src/InputHub.test.tsx, web/src/Today.test.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. Overlay placement (a11y): OK with one gap. constraintSheetOverlay (InputHub.tsx:608) + conflict sheet (Today.tsx:181) render role="dialog" aria-modal="true" as siblings of <main>, not children — correct, dialogs should not nest inside labeled <main>. No portal needed (overlay sits at root). Gap: no focus-trap — keyboard focus can escape behind modal. Acceptable for now but flag for follow-up; not a crash regression.

2. Both-blocked check: Safe, no crash. const [optA, optB] = conflict.options (Today.tsx:176); when length<2, optB undefined, optA?.peopleGuard?.blocked && optB?.peopleGuard?.blocked (line 259) short-circuits falsy. Map body if (!opt) return null (line 189) guards render. Confirmed no crash.

3. Test mock disambiguation: Correct. url.includes("/api/people") && !url.includes("hard-constraints") (InputHub.test.tsx:668/690/713) routes GET list separately from PUT .../hard-constraints; PUT asserted via c[0].includes("/hard-constraints") && c[1]?.method === "PUT" (line 678). Clean separation.

No regressions found. All 118 tests pass.

## Sonnet Response
- 적용 (concern 1): 현재 구현(sibling-of-main, no portal) 유지. Advisor가 portal 불필요 확인. focus-trap gap은 회귀(crash)가 아니므로 본 step 범위 내 변경 없음.
- 무시 (focus-trap 미구현): 이번 cycle plan.md Sprint Contract 범위(People Guard A: weekday hard-constraint + guard 표시) 밖. focus-trap 도입은 별도 a11y 작업 — scope 확장이 되어 user intent와 충돌. follow-up 후보로만 기록.
- 적용 (concern 2): 추가 조치 불필요. optional chaining + map guard로 options.length<2 crash path 없음 확인됨.
- 적용 (concern 3): 추가 조치 불필요. GET/PUT mock disambiguation 정확.
