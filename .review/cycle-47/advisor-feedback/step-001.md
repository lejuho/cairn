# Step 001 — Approach check: Preparation Suggestions A (cycle-47)

Cycle: 47
Pass: 1
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Evidence (first-match order event_title→thread_name→thread_goal, shared object): OK, deterministic.
2. Normalization (lowercase haystack + Latin keyword, collapse ws, Hangul as-written): OK.
3. Dedupe vs `preparations[].resource.name` (trim-exact): OK, matches edge case 1.
4. `key="presentation:<name>"` stable, no time/random: OK; mirrors PromotionSuggestion candidateKey.
5. Page-level render + page-level addEventPreparation, ScheduleBriefSection display-only: OK, cycle-46 precedent.

Add:
- `preparationSuggestions` required array to `.strict()` ScheduleBriefSchema; new `.strict()` ScheduleBriefPreparationSuggestionSchema.
- reasonCode token = `presentation_keyword`; brief gate = `brief_preparation_suggestions` (matches brief_* family).
- Unit tests beside existing services + extend eventDetail.test.ts strict-reject cases.
- buildPreparationSuggestions pure (no DB/LLM), param-injected into buildScheduleBrief like preparations.

## Sonnet Response
- 적용: 1 — evidence 첫 매칭 필드(고정 순서), 3개 item 공유
- 적용: 2 — Latin 소문자화 + 공백 정규화, Hangul as-written
- 적용: 3 — preparations[].resource.name과 trim-exact 비교로 중복 억제
- 적용: 4 — key="presentation:<name>" 안정
- 적용: 5 — page-level 렌더 + page-level addEventPreparation, ScheduleBriefSection display-only 유지
