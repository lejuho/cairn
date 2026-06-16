---
name: backend-fastify
description: Cairn Fastify backend work with Node.js LTS, TypeScript, Drizzle ORM, better-sqlite3, Google Calendar inbound sync, and the Grok OAuth proxy gateway. Use for server routes, services, repositories, SQLite schema or migrations, sync jobs, cron, push parsing, and LLM gateway changes.
---

# Cairn Fastify Backend

## Preserve boundaries

- Keep `server` as the API and job owner; put shared API types and runtime
  schemas in `shared`.
- Treat the Raspberry Pi SQLite file as the only source of truth.
- Keep deterministic services independent from the LLM gateway. Conflict,
  feasibility, watcher A, reads, aggregates, graph traversal, and settlement
  must work while the Grok proxy is unavailable.

## Validate routes

- Parse params, query, and body with a runtime schema before calling a service.
- Return a stable typed success or error shape defined in `shared`.
- Keep Fastify handlers thin: validate, call one service boundary, map the
  result. Do not embed SQL, sync loops, or LLM prompts in route handlers.
- Do not use `any`, unchecked casts, or raw request bodies as domain values.

## Use SQLite and Drizzle

- Define the schema from `docs/cairn-spec.md` section 0.2 with Drizzle.
- Persist enum values in lowercase exactly as documented.
- Generate migrations with `drizzle-kit`; never mutate an applied migration.
- Enable and test foreign keys. Use explicit transactions for multi-table
  state changes and idempotent sync writes.
- Query only needed columns. Keep `better-sqlite3` transactions short so
  synchronous database work does not monopolize the server process.
- Test constraints, transactions, migration application, and sync idempotency
  against a real temporary SQLite database.

## Keep Google Calendar inbound-only

- Import external events as `source='gcal'` and `self_imposed=0`.
- Preserve the external identity needed for idempotent upsert.
- Do not implement Cairn-to-GCal export or mirror recovery unless a future
  plan explicitly adds that scope.

## Isolate Grok behind one gateway

- Call only the existing OAuth-session proxy's Cairn-specific
  `/v1/chat/completions` endpoint. Do not add a metered API key or call Grok
  directly from routes, jobs, or repositories.
- Read the proxy base URL from `LLM_PROXY_BASE_URL`, defaulting locally to
  `http://localhost:8000`. Append `/v1/chat/completions` in the gateway; use
  the container-network base URL in container deployments.
- Keep the proxy as a separate process and port; do not rewrite or embed its
  existing implementation into `server`.
- Centralize timeout, bounded retry, rate-limit queueing, response validation,
  and health state in the server LLM gateway.
- Persist push reply raw text before invoking the proxy. On proxy failure,
  keep structured fields unknown and leave the input retryable.
- For generation requests, return an explicit unavailable result. Never
  fabricate a partial thread, inferred facts, or a successful response.
- Avoid retries for validation and authentication failures. Prevent retry
  storms with bounded attempts and queue capacity.

## Verify failure modes

- Test proxy timeout, connection refusal, invalid response, OAuth expiry, and
  rate limiting.
- Use the proxy's verified mock mode (`mock: true`) for gateway contract tests;
  never enable mock mode as the production fallback.
- Prove deterministic endpoints still pass when the proxy is absent.
- Prove push input survives gateway failure and generation fails without a
  partial database write.
