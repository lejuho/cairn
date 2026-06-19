# Access Session Recovery UX 구현 계획

Branch: `feature/cycle-20-access-session-recovery`
Cycle: `20`
Created: `2026-06-19`
Skills: `frontend-react-pwa`

## Summary

Production is now exposed through Cloudflare Access + Tunnel. Local host checks
show Fastify (`127.0.0.1:3100`), Caddy (`:18080`), and the Grok proxy (`:8000`)
can all be healthy while the browser still shows "데이터를 불러오지 못했어".

The observed external curl result for `https://cairn.lee-blog.me/api/today`
was `HTTP/2 302` to Cloudflare Access login, not an application/API failure.
The PWA shell can remain cached and visible, but API fetches may receive an
Access redirect, Access HTML, or a browser fetch rejection after the Access
session expires.

Cycle 20 makes that state explicit in the frontend: API fetches should detect
auth/session redirects and render a recovery path instead of a generic data-load
failure.

Preparation pass creates only `.review/cycle-20/*` artifacts and stops before
implementation.

Out of scope:
- Cloudflare dashboard policy changes.
- Adding app-level auth.
- Service-token or bypass configuration for `/api/*`.
- Server route changes.
- Caddy config changes.
- New DB migrations.
- New LLM use.

## 입력/출력 명세

- Frontend API fetch boundary
  - Input:
    - Existing relative API calls such as `/api/today`, `/api/threads`,
      `/api/events/:id`, `/api/capture/flat-event`, `/api/decisions/conflicts`.
  - Output:
    - Success: existing parsed JSON return behavior.
    - Failure:
      - Detect likely Cloudflare Access/session failure.
      - Throw or return a typed frontend error with:
        - `kind: "access_session_required"`.
        - user-facing title/copy.
        - recovery action label.
      - Other network/API failures remain generic fetch/API errors.

- Access/session detection
  - Treat any of these as `access_session_required`:
    - `response.redirected === true` and final `response.url` contains
      `cloudflareaccess.com` or `/cdn-cgi/access/login`.
    - HTTP `401`, `403`, or `302` from an API fetch when visible to fetch.
    - `content-type` is HTML/text instead of JSON for an API fetch and the body
      contains Cloudflare Access markers such as `Cloudflare-Access`,
      `/cdn-cgi/access/login`, or `cloudflareaccess.com`.
  - Browser CORS/network rejection cannot always be distinguished from Access.
    For rejected API fetches on production host, show copy that includes both:
    "로그인 세션이 만료됐거나 네트워크가 끊겼어".

- Recovery action
  - A button/link in error surfaces:
    - Label: `Access 로그인 다시 열기`.
    - Behavior: full-page navigation to the current path, preserving query/hash
      if present. This lets Cloudflare Access intercept and refresh the session.
  - Secondary action remains existing `다시 시도` where the screen already has it.

- User-visible copy
  - Today and Input surfaces should avoid generic-only failure when Access is
    likely:
    - Title: `로그인 세션이 필요해`.
    - Body: `Cloudflare Access 세션이 만료됐거나 아직 인증되지 않았어. 다시 로그인한 뒤 이 화면으로 돌아오면 돼.`
  - Generic errors keep existing tone and do not mention Access.

## Key Changes

- Frontend:
  - Add a small shared web API helper, for example `web/src/api.ts`, that wraps
    `fetch` + JSON parsing and normalizes errors.
  - Migrate at least these API entrypoints to the helper:
    - `Today.tsx` initial `/api/today` fetch.
    - Today detail/annotation/status/slot/capture/conflict fetches touched by
      the Today screen.
    - `InputHub.tsx` top-level data loads and mutations.
    - Thread index/detail/new fetches only if implementation can keep the
      change small; otherwise document them as next follow-up and do not
      partially invent a second pattern.
  - Add an `AccessSessionNotice` or equivalent small component if duplication
    appears in more than one screen.
  - Preserve loading, quiet, live, and generic error states.
  - Do not force automatic redirects. User taps the recovery action.

- Tests:
  - Add unit tests for the API helper's response classification.
  - Add UI tests proving Today renders Access-specific recovery copy/action
    when `/api/today` receives Access redirect/HTML or a rejected fetch.
  - Add InputHub coverage for the same top-level Access failure if InputHub
    uses the shared helper in this cycle.
  - Preserve existing generic error tests.

- Docs:
  - Update `docs/codebase-map.md` after implementation:
    - mention `web/src/api.ts` as the frontend API/fetch boundary.
    - mention Access session recovery handling in Web Map.
  - Optionally add a short note to `README.md` only if it already discusses
    production usage/troubleshooting; no broad README rewrite.

## Sprint Contract

- 통과 기준:
  - API fetch wrapper detects Cloudflare Access redirect/HTML/401/403 as a
    typed `access_session_required` frontend error.
  - API fetch wrapper still parses normal JSON success.
  - API fetch wrapper still distinguishes generic API errors from Access errors.
  - Today top-level load shows Access-specific title/copy/action for Access
    session failures.
  - Today generic network/API failure still shows existing generic recovery
    behavior.
  - Recovery action performs full-page navigation to the current URL.
  - No server route, DB schema, migration, LLM, Telegram, GCal, or Caddy changes
    are introduced.
  - `docs/codebase-map.md` is updated if a helper/component is added.

- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- 테스트 케이스:
  - Web unit: JSON `200` response returns parsed data.
  - Web unit: `302`/redirected response to Cloudflare Access becomes
    `access_session_required`.
  - Web unit: HTML body with Access login marker becomes
    `access_session_required`.
  - Web unit: HTML body without Access marker remains generic non-JSON error.
  - Web unit: rejected fetch on production host maps to Access-or-network copy.
  - Today UI: Access error shows `로그인 세션이 필요해`.
  - Today UI: `Access 로그인 다시 열기` invokes full-page navigation.
  - Today UI: generic failure still shows `데이터를 불러오지 못했어`.
  - InputHub UI: Access error gets the same recovery behavior if migrated.

- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Service worker serves a stale shell while every API route redirects to Access
  login. The UI must not loop or auto-redirect repeatedly.
- Fetch follows a cross-origin Access redirect and fails as a CORS/network
  rejection before exposing the response. The copy must still guide re-login.
- A real server `500` returns HTML from Caddy or another proxy. Do not falsely
  label every HTML response as Access unless Access markers or production
  rejected-fetch heuristics match.

## 더 단순한 대안 1개

Change the existing generic error copy to "로그인해봐" everywhere. This is
faster, but it hides real API/server failures and makes local development
confusing. A small typed fetch boundary keeps Access/session failures separate
from ordinary API errors.

## Assumptions

- Cloudflare Access remains the external auth boundary for now.
- The app itself still has no app-level auth in Cycle 20.
- Access redirects may appear as `302`, final redirected HTML, or browser fetch
  rejection depending on browser/CORS behavior.
- The correct recovery is a user-initiated full-page navigation, not an
  automatic loop.
- The current observed issue is session/auth boundary UX, not Fastify/Caddy
  unavailability.

## Review Guidance

### Enumeration 필요 항목

- Frontend fetch boundary:
  - Search: `rg -n "fetch\\(|apiJson|access_session_required|cloudflareaccess|cdn-cgi/access" web/src`
  - Expected: API calls that were migrated use the shared helper; Access
    detection lives in one small boundary, not scattered ad hoc.

- Access recovery UI:
  - Search: `rg -n "로그인 세션|Access 로그인|access_session_required|AccessSession" web/src`
  - Expected: Today and any migrated screen render the same recovery behavior.

- Out-of-scope backend/config:
  - Search: `git diff --name-only master...HEAD`
  - Expected: no `server/src`, `server/drizzle`, `deploy/caddy`, or systemd
    config changes unless explicitly justified in review.

- Cloudflare docs:
  - Search: `rg -n "Cloudflare Access|web/src/api|Access session|세션" docs README.md`
  - Expected: codebase map updated; README touched only if it already has the
    relevant operational section.

### 검증 방식 가이드

- Frontend helper behavior can be tested with mocked `Response` objects and
  mocked rejected fetch promises.
- UI behavior can be tested with mocked `fetch`; no real Cloudflare network call
  is required.
- Integration tests are still run because the root verify contract expects them,
  but no new SQLite behavior is expected in this cycle.
- Reviewer should treat Cloudflare dashboard policy edits, server auth, Caddy
  rewrites, or bypass-token work as scope creep.
