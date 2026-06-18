# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Sheet note save does not refetch Today
- 위치: `web/src/Today.tsx:337`
- 분석: `handleDetailNote` posts the annotation and refetches event detail, but it never refetches the Today surface.
- 영향: Sprint Contract requires sheet note action to refetch detail and Today. This can leave stale Today cards visible after an annotation suppresses a needs-review event.
- 수정 방향: After successful note save, refresh Today as well as event detail. Add a frontend test that proves note submit calls the annotation endpoint, reloads event detail, and reloads `/api/today`.

### ISSUE-2 [MEDIUM] Needs-review and schedule-prompt event surfaces do not open the event sheet
- 위치: `web/src/Today.tsx:771`, `web/src/Today.tsx:822`
- 분석: `next_event` and timeline rows open the detail sheet, but the needs-review and schedule-prompt event title/summary areas are rendered as static text.
- 영향: Plan Key Changes explicitly require daily timeline, next-event, needs-review, and schedule-prompt event surfaces to open the sheet. Two of the four entry points are missing.
- 수정 방향: Make the event title/summary area in needs-review and schedule-prompt cards actionable via `handleOpenEventDetail(card.event.id)` while preserving the existing reply and slot buttons. Add frontend coverage for both entry points.

### ISSUE-3 [MEDIUM] Event detail people are not sorted by name/id
- 위치: `server/src/repositories/people.ts:33`
- 분석: `findEventWithPeople` selects attached people without an `orderBy`, so SQLite may return join/insertion order rather than the plan's sorted order.
- 영향: `GET /api/events/:id` output contract says `people` must be sorted by name/id. The current integration test only uses one person, so the contract is not proven.
- 수정 방향: Add `orderBy(asc(people.name), asc(people.id))` to the attached-people query and add an integration test with multiple people inserted in non-sorted order.

## Sprint Contract Check
- `GET /api/events/:id` returns event detail with people, annotations, nullable thread: PARTIAL. Shape exists, but people sort contract is missing.
- `GET /api/events/:id` rejects invalid id and missing event: PASS.
- `PATCH /api/events/:id/status` accepts lowercase event statuses only: PASS.
- `PATCH /api/events/:id/status` updates the event status and returns the updated row: PASS.
- Status patch rejects uppercase/unknown statuses: PASS.
- Status patch rejects missing event: PASS.
- Event detail/status routes have no LLM gateway dependency: PASS.
- `/today` opens an event action sheet from timeline events: PASS.
- Sheet status action patches status and refetches Today: PASS.
- Sheet note action posts to annotation intake and refetches detail/Today: FAIL.
- Raw-stored annotation result is displayed as saved, not fatal failure: PASS.
- Existing needs-review inline reply remains working: PASS.
- Existing schedule prompt remains working: PASS.
- No DB migration is added: PASS.
- `docs/codebase-map.md` is updated: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm test:integration`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)
