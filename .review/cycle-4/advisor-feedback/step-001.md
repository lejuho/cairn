# Step 001 — Annotation Intake service + LLM parse fallback (Approach check)

Cycle: 4
Pass: 2
Files Changed: (none yet — approach check before implementation)
Planned: shared/src/annotations.ts, server/src/repositories/annotations.ts, server/src/llm/annotationParser.ts, server/src/services/annotationIntake.ts, server/src/routes/annotations.ts, server/src/app.ts

## Advisor Verdict
PASS (with concrete recommendations on all 3 decision points)

## Advisor Feedback
ADVISOR — Annotation Intake approach

Decision 1 — annotations.updated_at
- Confirmed: `annotations` has NO updated_at; only `loggedAt` default (schema.ts:91-101).
- Existing pattern (tasks.ts:28-34, watchers.ts:31-37): `.update().set().where(eq).returning().all()` → `[row] ?? null`. No timestamp bump.
- Recommend: MATCH existing — no migration. `.returning().all()[0]` sufficient. Adding updated_at = scope creep vs. established convention; reject.

Decision 2 — gateway DI
- Confirmed: `buildServer(db?)` only (app.ts:9); routes get `db` param (events.ts:6). No gateway wired anywhere yet; index.ts builds gateway nowhere.
- Recommend: option (b) — add `gateway` param to buildServer, pass into `registerAnnotationRoutes(app, db, gateway)`, construct via `createLlmGateway()` in index.ts. Mirrors db DI exactly; testable; avoids per-request construction.
- Reject (a)/(c): violate existing constructor-injection-at-boundary pattern.

Decision 3 — JSON stringify/parse boundary
- Confirmed: repository layer owns it. watchers.ts:10 does `JSON.stringify` inside repo before insert.
- Recommend: REPOSITORY — `JSON.stringify(reasonTags)` in insert/update repo fns; parse on read in repo. Service stays domain-typed. Matches watchers convention.

Note: outcome CHECK constraint (`'done'|'cancelled'|'moved'|'late'`, schema.ts:103) and energy 1-5 — ParsedAnnotation must validate before write or insert throws.

## Sonnet Response
- 적용 (Decision 1): updated_at/last_write_at 추가하지 않음. 기존 tasks/watchers 패턴대로 `.update().set().where(eq).returning().all()[0]` 사용. plan.md "Out of scope: new annotation tables/columns"와도 일치.
- 적용 (Decision 2): option (b) — buildServer에 gateway 파라미터 추가, registerAnnotationRoutes(app, db, gateway)로 전달, index.ts에서 createLlmGateway() 생성. 기존 db DI 패턴 미러링.
- 적용 (Decision 3): repository 레이어에서 JSON.stringify/parse. watchers.ts:10 convention과 일치. service는 domain-typed(string[]) 유지.
- 적용 (추가 note): ParsedAnnotationSchema에 outcome enum(done|cancelled|moved|late) + energy 1-5 CHECK 제약을 반영해 write 전 validate. invalid 시 raw_stored fallback path로 보냄(insert throw 방지).
- 무시: 없음.
