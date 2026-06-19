# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Visible 302 Access responses are not classified
- 위치: `web/src/api.ts:40`
- 분석: `apiJson` maps `401` and `403` to `access_session_required`, and separately handles `response.redirected` with a Cloudflare Access URL. It does not handle a visible `302` status. The cycle was motivated by an observed external `HTTP/2 302` from `https://cairn.lee-blog.me/api/today` to Cloudflare Access login, and the plan explicitly requires visible `302` API responses to become `access_session_required`.
- 영향: If fetch exposes the 302 response directly, the helper will continue into HTML/text parsing. The simple `302 Found` body may not contain the configured Access markers, so Today can still fall back to generic `데이터를 불러오지 못했어`.
- 수정 방향: Include `302` in the Access-status branch, and add a unit test for `status: 302` with no redirect/body marker.

### ISSUE-2 [HIGH] Required Today/InputHub API entrypoints remain direct fetches
- 위치: `web/src/Today.tsx:52`, `web/src/InputHub.tsx:92`
- 분석: The plan says to migrate at least Today detail/annotation/status/slot/capture/conflict fetches and InputHub top-level data loads and mutations to the shared API helper. Implementation migrated only the top-level `/api/today` load and InputHub top-level `/api/today` + `/api/threads` reads. Direct fetch calls remain for task status, annotation intake, thread options, task/event creation, flat capture, event detail, slot candidates, schedule, conflict decisions/resolve, people loading/creation, and InputHub mutations.
- 영향: After the shell has loaded, an Access session expiry during these interactions can still produce JSON parse failures, generic local errors, or silent no-ops instead of the recovery UX required by this cycle.
- 수정 방향: Either migrate the planned Today and InputHub entrypoints to `apiJson` and map `AccessSessionError` to the same recovery behavior, or formally split the cycle. Since `plan.md` was not amended, review must treat the current implementation as incomplete.

### ISSUE-3 [MEDIUM] InputHub Access recovery has no UI test
- 위치: `web/src/InputHub.tsx:535`
- 분석: InputHub now has an `access_error` state and recovery button, but `web/src/InputHub.test.tsx` has no coverage for `로그인 세션이 필요해` or `Access 로그인 다시 열기`.
- 영향: The plan's test contract says InputHub gets the same recovery behavior if migrated. This state can regress without test coverage.
- 수정 방향: Add InputHub tests for top-level Access failure and recovery navigation, preserving existing generic error coverage.

## Sprint Contract Check
- API fetch wrapper detects Cloudflare Access redirect/HTML/401/403 as typed `access_session_required`: PARTIAL; 401/403/redirected/HTML marker pass, visible 302 blocked by ISSUE-1.
- API fetch wrapper still parses normal JSON success: PASS.
- API fetch wrapper still distinguishes generic API errors from Access errors: PASS for tested HTML 500; broaden after 302 fix.
- Today top-level load shows Access-specific title/copy/action: PASS.
- Today generic network/API failure still shows existing generic recovery behavior: PASS for ok=false API case.
- Recovery action performs full-page navigation to current URL: PASS.
- No server route, DB schema, migration, LLM, Telegram, GCal, or Caddy changes: PASS.
- `docs/codebase-map.md` is updated if a helper/component is added: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm test:integration`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan
No extra backend/config scope found. However, `docs/codebase-map.md` documents mutation fetches as deferred even though `plan.md` required those Today/InputHub entrypoints to be migrated in this cycle; this is tracked as ISSUE-2 rather than accepted scope reduction.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — api.ts에 302 status 분기 추가 + 단위 테스트
- `web/src/api.ts:41`: `res.status === 302 || 401 || 403` 분기에 302 추가
- `web/src/api.test.ts`: `status: 302` 케이스 단위 테스트 추가 (총 8 테스트)

RESOLVED: ISSUE-2 — Today.tsx + InputHub.tsx 직접 fetch → apiJson 전면 전환
- `web/src/Today.tsx`: `markTaskDone`, `submitAnnotation`, `loadThreadOptions`, `createTask`, `flatCapture`, `fetchEventDetail`, `patchStatus`, `createEvent` 모두 `apiJson` 사용
- `web/src/Today.tsx`: `handleCapture` silent `catch {}` → AccessSessionError `savedMsg` 표시
- `web/src/Today.tsx`: 시트 submit catch에서 `(e as AccessSessionError).kind` 패턴 적용 (plain object이므로 `instanceof Error` 불가)
- `web/src/Today.tsx`: reply, detail note submit catch 동일 패턴 적용
- `web/src/InputHub.tsx`: `handleCapture`, `handleFormSubmit` (event/task), `handleLoadCandidates`, `handleSchedule`, `handleAddPerson`, people useEffect 모두 `apiJson` 사용
- AccessSessionError는 top-level load → `setView(access_error)`, mutation → local error slot (화면 전환 없음)

RESOLVED: ISSUE-3 — InputHub Access 에러 UI 테스트 3개 추가
- `web/src/InputHub.test.tsx`: "로그인 세션이 필요해" 렌더 확인
- `web/src/InputHub.test.tsx`: "Access 로그인 다시 열기" 버튼 → `window.location.assign` 호출 확인
- `web/src/InputHub.test.tsx`: generic API 실패 시 Access copy 미노출 확인

자동 체크: lint ✅ / tsc ✅ / test (135 web + 225 integration) ✅ / build ✅
