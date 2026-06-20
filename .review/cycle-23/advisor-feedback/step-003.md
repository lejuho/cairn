# Step 003 — Approach check: cycle-23 review-v1 fixes (ISSUE-1, ISSUE-3, ISSUE-5)

Cycle: 23
Pass: 4
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. ISSUE-1: Use two separate `.refine()` calls (or `.superRefine` with two `ctx.addIssue` blocks using distinct `path`). Recommendation: two `.refine()` calls — distinct paths (`["preferredPeriods"]` for half-empty, `["unavailableWeekdays"]` for overlap), independent messages, both run. One combined `.superRefine` is fine only if you set separate `path` per issue; two `.refine()` is simpler and clearer here.

2. ISSUE-3: Choose (b) — make `hardConstraints`/`preferredWindows`/`leadTime` required in PersonRowSchema. The 4-col casts then fail typecheck, surfacing the omission at compile time with zero query cost. Do NOT pick (a) blanket: the join projections legitimately don't need authored fields. Better: define a narrow `EventPersonRow` (id/name/relation/channel) type for those projections and have `EventPeopleResponse.people` use it — drop the unsafe `as PersonRow[]` cast entirely. (a)'s extra reads + mapPersonRow are wasteful for join paths that discard those fields.

3. ISSUE-5: Sentinel-div approach. Recommendation: two focusable sentinel divs (`tabIndex=0`) before/after the sheet whose `onFocus` redirects to last/first interactive child. Robust to dynamic content (no stale ref list), no querySelectorAll re-scan on every Tab, fewer edge cases than tracking refs to all focusable children. Keep existing Escape + initial `closeButtonRef.current?.focus()`; add focus-restore to the trigger on close.

## Sonnet Response
- 적용 (ISSUE-1): two separate `.refine()` calls with distinct paths.
- 적용 (ISSUE-3): narrow `EventPersonRow` projection type for join paths + drop `as PersonRow[]` cast. (Advisor's refinement on top of option (b) — addresses the cast safely without extra column reads.)
- 적용 (ISSUE-5): sentinel-div focus trap + focus-restore to trigger on close.
- 무시: none.
