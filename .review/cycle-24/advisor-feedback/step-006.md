# Step 006 — review-v2 fixes (ISSUE-1, ISSUE-7, ISSUE-8) Completion

Cycle: 24
Pass: review-v2 resolution (Completion check)
Files Changed: web/src/Today.tsx, web/src/Today.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS (ship-ready; two non-blocking observations)

## Advisor Feedback
1. Worry 1 (focus stranding): handled. rAF re-query is the sole effective restore. When opener survives, rAF focuses live node; unmount cleanup targets the detached pre-refresh node (silent no-op). When conflict disappears, live=null, ?.focus() no-ops → focus falls to body, not stranded. Disappeared-conflict branch is correct-by-construction but untested (acceptable no-op path).
2. Observation (a): "kept unmount cleanup as fallback" overstates its role — the unmount cleanup is a detached-node no-op for the surviving-opener case; rAF is the effective restore.
3. Worry 2 (CSS.escape / rAF): no concern. Both standard in jsdom + evergreen browsers. CSS.escape is correct defensive practice on numeric `id:id` pairId.
4. Worry 3 (map ISSUE-7): confirmed accurate vs shared/src/people.ts:59-73 — two cross-field .refine on the schema itself (half-empty window + weekday overlap). Opener-restore map entry accurate.
5. Heading assertions exact (getByRole heading 미팅 B — 이동 / 취소). Accessibility test comprehensive for happy path.
Verdict: Ship-ready; neither observation warrants holding the cycle.

## Sonnet Response
- 적용 (2/observation a): 설명을 정정 — unmount cleanup은 surviving-opener 경로에서 detached-node no-op이고, rAF re-query가 실질 restore. cleanup는 무해한 방어막으로만 유지. RESOLVED 서술에 이 nuance 반영.
- 무시 (1/disappeared-conflict untested branch): 별도 테스트 추가하지 않음 (이유: correct-by-construction no-op 경로이며, plan/Sprint Contract는 opener restore happy-path와 stranding 회피만 요구. 추가 테스트는 advisor도 non-blocking으로 명시).
- 무시 없음 (3,4,5): 모두 PASS 확인.
