# Step 003 — cycle-20 review-v1 approach check: migrate remaining fetches

Cycle: 20
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Mutations + secondary reads: use local error slot, NOT setView access_error. Top-level loads already own the full screen. Mutations/detail fetches should route AccessSessionError into existing error slot with "로그인 세션이 만료됐거나 네트워크가 끊겼어". Prevents disruptive full-screen wipe mid-interaction.

2. Silent catches (capture, task-done): must surface AccessSessionError, not swallow. Thread-options: can stay graceful [] — missing dropdown is acceptable degradation.

3. apiJson signature (input, init?) is sufficient — no changes needed. All mutations pass init.

4. ISSUE-1: add 302 to status branch: `res.status === 401 || 403 || 302` + unit test.

5. Envelope checks (body.ok / body.error.message) stay after apiJson — apiJson only classifies transport/Access, not application errors.

## Sonnet Response
- 적용: 모든 항목 적용.
- ISSUE-1: 302 추가 + 단위 테스트.
- ISSUE-2: 모든 Today/InputHub 직접 fetch → apiJson, AccessSessionError → local error slot. capture/task-done silent swallow 해결. thread-options는 [] 유지.
- ISSUE-3: InputHub Access 에러 UI 테스트 추가.
