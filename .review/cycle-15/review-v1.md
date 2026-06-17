# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Event creation with people is not transactional
- 위치: `server/src/routes/events.ts:37`
- 분석: `POST /api/events` creates the event first, then calls `replaceEventPeople` afterward. `replaceEventPeople` has its own transaction for delete/insert, but the event insert is outside that transaction.
- 영향: Plan requires `POST /api/events` to attach people transactionally, and explicitly calls out avoiding a partial event-without-people surprise.
- 수정 방향: Add a repository/service function that validates people and inserts the event plus `event_people` rows inside one `db.transaction`, or wrap both operations in one route-level transaction without splitting the write boundary.

### ISSUE-2 [MEDIUM] Inline person creation misses the required relation field and refresh behavior
- 위치: `web/src/InputHub.tsx:201`
- 분석: The inline person POST body sends only `displayName` and `channel`; the rendered inline form has name/channel fields at `web/src/InputHub.tsx:355` and `web/src/InputHub.tsx:363`, but no optional relation input. After success, it locally appends/sorts the returned person instead of refreshing `GET /api/people`.
- 영향: Plan requires inline fields `display name, channel, relation optional`, and says success refreshes the people list and selects the created person.
- 수정 방향: Add relation to the inline state/form/body, cover it in the frontend test, and refresh the people list after create while preserving selection of the created id.

### ISSUE-3 [LOW] Blank relation is stored as an empty string, not null
- 위치: `server/src/repositories/people.ts:19`
- 분석: `input.relation?.trim() ?? null` turns `"   "` into `""`.
- 영향: Plan says relation trims to nullable string. Empty-after-trim should become `null`, not a stored empty string.
- 수정 방향: Normalize with a helper like `const relation = input.relation?.trim(); relation: relation ? relation : null`, and add an integration assertion for blank relation.

## Sprint Contract Check
- `GET /api/people` sorted by display name: PASS by integration test.
- `POST /api/people` trims display name/relation: PARTIAL. Normal trim passes, blank relation normalization is missing.
- Empty display name rejected: PASS.
- Invalid channel rejected: PASS.
- `GET /api/events/:id/people`: PASS.
- `PUT /api/events/:id/people` replace/detach/dedup/missing refs: PASS.
- `POST /api/events` accepts `personIds` and writes `event_people`: PARTIAL. Happy path passes, but transactional write contract is not met.
- Existing event creation without `personIds`: PASS.
- `/input` loads people and submits selected ids: PASS.
- People fetch failure keeps form usable: PASS by test coverage.
- Inline person creation works/selects created person: PARTIAL. Basic create/select passes, but relation field and refresh behavior are missing.
- No DB migration added: PASS.
- No LLM imports added: PASS; no new people path imports the LLM gateway.
- `docs/codebase-map.md` updated: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check`: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)
