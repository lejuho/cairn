# Step 001 — Approach check: Navigation + Input Hub (AppNav, App.tsx wrap, InputHub)

Cycle: 14
Pass: 2
Files Changed: (planned) AppNav.tsx, App.tsx, InputHub.tsx, Today.tsx, AppNav.test.tsx, InputHub.test.tsx, Today.test.tsx

## Advisor Verdict
PASS

## Advisor Feedback
Decision points:

**1. AppNav location → wrap in App.tsx**
- Single source of truth for routes; pages stay focused
- Page tests render page-only (no nav coupling) IF nav isn't imported by page
- Counter: page tests lose nav; acceptable — test AppNav separately
- Caveat: avoid double-wrap; one `<AppNav/>` per render branch in App.tsx

**2. "quiet" definition → NOT just unscheduledEvents===0**
- Spec: "no relevant pending items" = InputHub's actionable inputs
- quiet = unscheduledEvents.length===0 (threads = picker resource, not pending signal)
- Correct, but name the predicate explicitly; live when ≥1 unscheduled

**3. Test fetch mock → URL-branching sufficient**
- 2 endpoints, deterministic; URL-branch in `vi.fn` mock
- Extract helper only if Today.test already has one — reuse, don't duplicate
- Assert Promise.all both fired; cover error when one rejects

## Sonnet Response
- 적용 (D1): AppNav를 App.tsx에서 wrap. 각 render branch당 단일 `<AppNav/>`만 두어 double-wrap 회피. 페이지 컴포넌트는 nav를 import하지 않아 기존 페이지 테스트는 nav-coupling 없이 유지. AppNav는 별도 AppNav.test.tsx로 검증.
- 적용 (D2): quiet 판정을 명시적 predicate로 분리. unscheduledEvents.length === 0 → quiet, ≥1 → live. threads는 picker resource이므로 pending signal에서 제외 (quiet 판정에 미반영).
- 적용 (D3): URL-branching mock 사용. Today.test에 기존 fetch helper가 있으면 reuse, 없으면 inline (중복 helper 생성 안 함). Promise.all 양쪽 fire 검증 + 한쪽 reject 시 error state 케이스 포함.
- 무시: 없음.
