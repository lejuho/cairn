# Step 003 — Approach check: cycle-22 review-v1 fix (ISSUE-1..4)

Cycle: 22
Pass: 4
Files Changed: web/src/styles.css, web/src/PeopleDirectory.tsx, web/src/PersonDetail.tsx, web/src/lastMet.ts (new), web/src/PeopleDirectory.test.tsx, web/src/PersonDetail.test.tsx, server/src/routes/people.integration.test.ts

## Advisor Verdict
GUIDANCE

## Advisor Feedback

**ISSUE-2 CSS — confirm new scoped selectors:**
1. Correct. New selectors avoid overloading shared `.quiet-card`/`.action-btn` semantics (ISP/coupling).
2. Must-haves: reuse tokens only (--surface/--border/--text/--muted/--accent); 44px min tap targets; `:focus-visible` outline on `.back-link`/`.action-btn`/`.person-card`; single-column mobile default; wide-layout (media min-width) multi-column enhancement; wrap any animation in `prefers-reduced-motion: reduce` → none.

**ISSUE-3 formatLastMet — extract:**
3. Extract to shared util. Two divergent copies already drifting; one source prevents date/time format skew. Add unit test there.

**ISSUE-4 window.location.assign spy (jsdom):**
4. In test: `delete (window as any).location; window.location = { ...origLocation, assign: vi.fn() } as any;` then assert. Restore in `afterEach`. Reassign whole `location` since `assign` is non-configurable.

## Sonnet Response
- 적용: ISSUE-1 dead ALICE 선언/void 제거. ISSUE-2 styles.css에 새 scoped selector 추가 (token만 사용, 44px, focus-visible, single-column 모바일 기본 + wide min-width 향상, reduced-motion). ISSUE-3 formatLastMet를 web/src/lastMet.ts로 추출, date/time 포함, 양 화면이 import. ISSUE-4 retry fetch 재호출, Access window.location.assign spy (location 전체 reassign), known/null lastMet copy assertion 추가. backend malformed/moved/late/future/equal-end tie-break integration 케이스 추가.
- 무시: 없음. 4개 issue 전부 APPLY (plan.md Sprint Contract와 정합).
