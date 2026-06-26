# Step 001 — Approach review: Thread Resume Export A (cycle-57)

Cycle: 57
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
APPROVE

## Advisor Feedback
1. Error order: Correct. Input validation (400) before resource state. not_found(404)→not_done(409)→not_marked(409)→empty(409) sound; distinct codes give stable taxonomy.
2. Empty def: Right. All-3-star-null AND normalized-skills-empty prevents misleading blank artifact.
3. Determinism/safety: Sound. Pure builder + display-only normalization (no mutation) + goal-as-context (no fabricated star_task) + literal Markdown. Ensure skill dedupe order-stable; JSON.stringify deterministic.
4. Read-only: Within contract. findThreadById+findThreadResume only, no write, no gateway, registerThreadRoutes.
5. Frontend: Adequate. Gating done+relevant+non-empty, tap fetch, scoped state. Render Markdown as text (no dangerouslySetInnerHTML).
One caution: keep eligibility logic (empty/not_marked) single-sourced in service, not duplicated in frontend gating.

## Sonnet Response
- 적용: 1 — id+format 400 먼저, then not_found 404 / not_done 409 / not_marked 409 RESUME_NOT_MARKED / empty 409 RESUME_EMPTY / ok 200
- 적용: 2 — star 3필드 null AND 정규화 skills 빈 배열 → RESUME_EMPTY
- 적용: 3 — 순수 builder, skills 표시용 정규화(trim/blank제거/순서보존 dedupe, 저장 미변경), goal-as-context warning, Markdown 리터럴
- 적용: 4 — findThreadById+findThreadResume read만, write/gateway 없음, registerThreadRoutes 등록
- 적용: 5 — done+relevant+non-empty gating, tap fetch, scoped preview/loading/error, Markdown은 <pre> text 렌더(no dangerouslySetInnerHTML), download/apply/score 없음
- 적용(caution): eligibility는 service 단일 소스 — frontend gating은 컨트롤 가시성용일 뿐, 서버가 권위. 빈/미표시 판단은 서버 에러로 강제
- 무시: 없음
