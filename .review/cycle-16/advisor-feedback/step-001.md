# Step 001 — Approach check: Event Action Sheet A (GET detail, PATCH status, Today sheet)

Cycle: 16
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Decision [1]: orchestrate in route/service — reuse findEventWithPeople + findThreadById + NEW findAnnotationsByEvent. Do NOT build a mega-repo function; repos stay single-responsibility.
2. Guard: findEventWithPeople returns null/empty on missing id → 404 before thread/annotation calls.
3. thread nullable: only call findThreadById when event.threadId set; map to {id,name} or null.
4. Decision [2]: thin route, but add returning() to updateEventStatus (or repo-level findEventById pre-check) so 404 is real, not silent void.
5. Validate status via shared lowercase EventStatus enum/zod; reject uppercase. No LLM import — keep route gateway-free.
6. Decision [3]: local selectedEventId + fetch-on-open. Matches loadSurface/loadThreadOptions JIT pattern; pre-fetch-all violates it and over-fetches.
7. Refetch: reuse the same GET-detail fetcher after status/note actions.

## Sonnet Response
- 적용 [1]: GET /api/events/:id를 route/service에서 orchestrate. 기존 `findEventWithPeople`(people repo) + `findThreadById`(threads repo) 재사용, annotations repo에는 NEW `findAnnotationsByEvent`(newest-first) 1개만 추가. mega-repo function 만들지 않음 — repo single-responsibility 유지.
- 적용 [1-guard]: `findEventWithPeople` null → 404 먼저 반환, 그 다음 thread/annotation 조회. event.threadId 있을 때만 `findThreadById` 호출 후 `{id,name}` 또는 null 매핑.
- 적용 [2]: thin route in registerEventRoutes(app, db) — gateway 미주입 경로라 그대로 deterministic 보장. 단 `updateEventStatus`가 void 반환이라 silent no-op 404 위험. → `findEventById` pre-check로 404 처리(기존 annotations route와 동일 패턴, 일관성 우선). status는 shared lowercase EventStatus zod로 검증, 대문자/unknown 거부. LLM import 없음.
- 적용 [3]: Today.tsx local selectedEventId + open 시 GET detail fetch. 기존 loadSurface/loadThreadOptions module-level async fetcher JIT 패턴과 일치. pre-fetch-all 거부(over-fetch + 패턴 위반). status/note action 후 동일 detail fetcher + loadSurface 재호출로 refetch.
- 무시: 없음. 7개 항목 모두 plan.md Sprint Contract 및 user intent와 정합.
