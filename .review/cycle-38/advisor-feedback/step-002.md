# Step 002 — Completion check: cross-cutting-relations-a (resources/resource_links, resource-focus route, Thread focus section)

Cycle: 38
Pass: 2
Files Changed:
- server/src/db/schema.ts
- server/drizzle/0003_orange_zaran.sql
- server/src/repositories/resources.ts
- server/src/routes/resources.ts
- server/src/app.ts
- server/src/db/schema.integration.test.ts
- server/src/routes/resources.integration.test.ts
- shared/src/resources.ts
- shared/src/resources.test.ts
- shared/src/index.ts
- web/src/Thread.tsx
- web/src/Thread.test.tsx
- web/src/styles.css
- docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All verified.

Verdict: PASS

- Concern 1 (Thread tests): All converted to URL-dispatch `mockImplementation` keyed on `resource-focus`; no order-dependent `mockResolvedValueOnce` chains remain. Web suite 306/306 pass.
- Concern 2 (idempotency): UNIQUE index `resource_links_unique_idx` on (resource_id, target_type, target_id) exists in both schema.ts:271 and migration 0003. `.onConflictDoNothing()` no-ops on conflict, then re-selects existing row → first-write-wins. Test line 225 asserts firmness stays "soft". Passes.
- Concern 3 (failure isolation): `loadResourceFocus` has internal `try/catch → null`, so it never rejects; `Promise.all` reject path is exclusive to `loadThread`. Reject test (line 507) confirms section hidden, detail unaffected. Both `useEffect` and `refresh` paths mirror this correctly.
- Server integration: 25/25 pass.

Note: running `Thread.test.tsx` standalone via root `npx vitest` gave false `document is not defined` failures — that is a wrong-config invocation artifact, not a code issue. Use `cd web && npx vitest run` (jsdom env) and `cd server && pnpm test:integration` for the real signal.

## Sonnet Response
- 적용: PASS verdict 수용. 세 회귀 우려 모두 Advisor가 코드/테스트 레벨에서 검증 완료. 추가 변경 불필요.
- 적용: 테스트 실행 시 root `npx vitest`가 아닌 디렉터리별 실행(`cd web && npx vitest run`, `cd server && pnpm test:integration`)을 사용 — jsdom env 누락으로 인한 false `document is not defined` 회피.
- 무시: 없음 (모든 피드백 적용).
