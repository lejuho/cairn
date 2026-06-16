# Project Foundation and Core SQLite Schema Implementation Plan

Branch: feature/cycle-1-foundation
Cycle: 1
Created: 2026-06-16
Skills: backend-fastify, frontend-react-pwa

## Summary

Cairn currently has stack decisions and domain skills, but no application
scaffold, package commands, database migration, or executable test contract.

This cycle creates the pnpm monorepo foundation: React/Vite PWA shell,
Fastify server, shared TypeScript/Zod contracts, Drizzle + better-sqlite3
SQLite schema, the first migration for all spec 0.2 tables, Vitest checks,
and exact root commands in AGENTS.md. It does not implement real GCal sync,
Gmail parsing, push delivery, auth, remote access, Today product data,
offline write reconciliation, or real Grok calls.

## 입력/출력 명세

- 입력:
  - endpoint: `GET /health`
  - content-type: none
  - field: none
  - auth: none
  - env: `LLM_PROXY_BASE_URL` optional, defaults to `http://localhost:8000`
- 출력:
  - 정상:
    - `GET /health` returns HTTP 200 and
      `{ "ok": true, "data": { "service": "cairn-server", "status": "ok" } }`
    - Web root `/` redirects to `/today`.
    - `/today` renders the quiet PWA shell.
    - Drizzle migration creates all 10 spec 0.2 SQLite tables.
  - 실패:
    - LLM gateway proxy down returns an explicit unavailable result from the
      gateway without throwing into deterministic services.
    - Database constraint violations are rejected by SQLite.

## Key Changes

- Workspace
  - Create root `package.json`, `pnpm-workspace.yaml`, lockfile, shared
    TypeScript configs, and root scripts.
  - Create packages `@cairn/web`, `@cairn/server`, and `@cairn/shared`.
- Shared
  - Define lowercase enum constants, API response types, `GET /health`
    response schema, and LLM chat request/response schemas with Zod.
- Backend
  - Create Fastify TypeScript app and `GET /health`.
  - Add Drizzle schema and committed first migration for `threads`, `events`,
    `annotations`, `tasks`, `links`, `thread_links`, `people`,
    `event_people`, `watchers`, and `params`.
  - Add DB helpers that enable foreign keys for every connection.
  - Add LLM gateway module using `LLM_PROXY_BASE_URL`, default
    `http://localhost:8000`, and `/v1/chat/completions`.
  - Implement gateway defaults: timeout `10000ms`, retry count `1` for
    transient network/5xx only, queue concurrency `1`, queue capacity `8`.
- Frontend
  - Create React + Vite + `vite-plugin-pwa` shell.
  - Implement `/today` quiet shell with semantic tokens, manifest/service
    worker build, reduced-motion handling, and root redirect to `/today`.
- Docs
  - Replace AGENTS.md Commands with exact root scripts that exist.

## Sprint Contract

- 통과 기준:
  - `pnpm install` succeeds and produces a committed lockfile.
  - `pnpm verify` runs lint, typecheck, unit tests, integration tests, and build.
  - `pnpm db:generate` is backed by Drizzle config and the committed first
    migration.
  - `pnpm test:integration` applies the committed migration to a temporary
    SQLite DB.
  - AGENTS.md command list contains only scripts that actually exist.
- 자동 체크:
  - Root: `pnpm verify`
  - Build: `pnpm build`
  - Typecheck: `pnpm typecheck`
  - Lint: `pnpm lint`
  - Unit: `pnpm test`
  - Integration: `pnpm test:integration`
  - Migration generation check: `pnpm db:generate`
- 테스트 케이스:
  - Integration: all 10 tables exist; FK enforcement is enabled; invalid
    uppercase enum values are rejected; representative FK violation is
    rejected; `event_people` composite PK rejects duplicates.
  - Server unit: `GET /health` exact shape; LLM gateway calls
    `/v1/chat/completions`; `mock: true` contract works against local mock
    server; proxy-down returns explicit unavailable.
  - Web unit/build: `/today` shell renders quiet state; PWA build emits
    manifest and service worker assets.
  - Manual: run `pnpm dev` and confirm server and web start without real
    external integrations.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Tests accidentally mutate the real Raspberry Pi DB instead of temporary
  SQLite files.
- LLM proxy outage breaks deterministic routes or database tests.
- TypeScript uppercase enum names leak into persisted SQLite values.

## 더 단순한 대안 1개

Only scaffold root packages and defer DB migration to Cycle 2 — 채택하지 않은
이유: later cycles need a stable SQLite contract and real constraint tests;
deferring migration would leave the foundation unreviewable.

## Assumptions

- Node.js is `v22.22.0`; pnpm is `10.9.0` because `pnpm@10.9.4` is not
  published in the npm registry.
- Zod is the runtime schema library for `shared`.
- First migration covers all spec 0.2 tables.
- The web scope is PWA shell only, not Today product data.
- No auth is implemented in Cycle 1; external exposure remains blocked until a
  later access-boundary cycle.
- Mock LLM mode is for tests only and never a production fallback.

## Review Guidance

### Enumeration 필요 항목

- Drizzle table definitions
  - 검색: `rg -n "sqliteTable\\(" server`
  - 예상 결과: exactly 10 table definitions matching spec 0.2.
- Root command contract
  - 검색: `rg -n "pnpm (dev|build|typecheck|lint|test|test:integration|db:generate|db:migrate|verify)" AGENTS.md package.json`
  - 예상 결과: every documented command has a root script.
- LLM boundary
  - 검색: `rg -n "LLM_PROXY_BASE_URL|localhost:8000|/v1/chat/completions" server AGENTS.md docs`
  - 예상 결과: direct proxy URL usage only inside the gateway/config path and
    documentation.

### 검증 방식 가이드

- "all 10 tables exist":
  - Requires real temporary SQLite integration test after applying the
    committed migration; mock tests are insufficient.
- "FK enforcement and constraints":
  - Requires `PRAGMA foreign_keys` on the actual test connection plus
    constraint violation tests; schema inspection alone is insufficient.
- "LLM wire contract":
  - Mock HTTP server is sufficient. Do not call the real Grok proxy in tests.
- "PWA assets emitted":
  - Requires `pnpm build` and checking build output for manifest/service worker
    files; component tests alone are insufficient.
- "AGENTS.md commands are real":
  - Verify every documented root command maps to an actual root package script.
