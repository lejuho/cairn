# Step 002 — Flat one-line capture (schema, parser, service, route, web form)

Cycle: 12
Pass: 2
Files Changed: shared/src/capture.ts, shared/src/index.ts, server/src/llm/flatEventParser.ts, server/src/services/flatCapture.ts, server/src/routes/capture.ts, server/src/routes/capture.integration.test.ts, server/src/repositories/events.ts, server/src/app.ts, web/src/Today.tsx, web/src/Today.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All Sprint Contract items verified against the changed files. Findings below.

1. Empty-text rejection: `FlatCaptureRequestSchema` trims + `min(1)`; route returns typed `400 VALIDATION_ERROR`. PASS.
2. Scheduled insert: `createEvent` sets `source='cairn'`, `selfImposed=1`, `status='planned'`, `threadId=null`; no link rows (grep confirms NONE). PASS.
3. Missing `end` → `addMinutesToRfc3339(start,60)`; offset-preserving (not UTC `toISOString`). Regression concern #2 satisfied. PASS.
4. No-start parse → `insertRawEvent(parsed.title)` with `start=null,end=null`, status `unscheduled`. PASS.
5. Parser null (unavailable/timeout/rate-limit/invalid JSON/invalid schema) → `insertRawEvent(trimmed)`, status `raw_stored` with `llmError`. `parseFlatEvent` returns null on `!result.ok`, JSON.parse catch, and safeParse failure. Multi-item/offset-less start fail safeParse → raw-store (edge cases covered). PASS.
6. `insertRawEvent` field values identical to `createEvent` (source/selfImposed/status) — regression concern #1 satisfied; Today aggregation unaffected. PASS.
7. `dayEvents` boundary: `findEventsByDate` filters `start != null && start.startsWith(date)`, so unscheduled (`start=null`) excluded. Regression concern #3/#4: no thread/link rows created. PASS.
8. Today LLM boundary: no LLM import in today route/service (grep NONE). PASS.
9. Route gated on both db AND gateway (registered inside `if (gateway)` block in `buildServer`, mirroring annotation route). PASS.
10. No new migration (drizzle unchanged); `exactOptionalPropertyTypes` handled via conditional spread in both route and `createEvent`. 13 integration tests present matching contract cases. PASS.

Minor observation (non-blocking): `flatCapture.ts` `parseFlatEvent` already swallows errors internally and returns null, so the `try/catch` in `captureFlat` populating `llmErrorMsg` will rarely fire — `llmError` is usually `undefined` even on parse failure. This matches the contract (`llmError` is optional) but the field is effectively cosmetic; not a regression.

Verdict: PASS

## Sonnet Response
- 적용: 모든 Sprint Contract 항목 PASS 확인. 추가 변경 불요.
- 무시: minor observation(llmError가 사실상 cosmetic) — 의도된 동작. contract상 llmError는 optional이며, parseFlatEvent가 null로 정상화한 뒤 captureFlat의 try/catch는 방어용 2차 경계로 유지. 회귀 아님이므로 변경하지 않음.
