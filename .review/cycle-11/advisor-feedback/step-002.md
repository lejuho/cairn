# Step 002 — production access boundary (deploy artifacts + docs)

Cycle: 11
Pass: 2
Files Changed:
- deploy/systemd/cairn-server.service.example
- deploy/env/cairn-server.env.example
- deploy/caddy/Caddyfile.example
- docs/deployment-cloudflare-access.md
- README.md
- docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. HOST=127.0.0.1 confirmed — server unreachable except via Caddy loopback proxy. Correct.
2. Caddy binds 127.0.0.1:8080 (not :8080) — tighter than reported; only cloudflared reaches it. Good.
3. handle blocks: /api/* and /health proxy to 3100; catch-all serves PWA with try_files inside handle — valid Caddy v2. Correct.
4. systemd: User=pi, EnvironmentFile outside repo, Restart=on-failure. Sound.
5. env: placeholders only, DB_PATH note flags plan/code mismatch resolved to DB_PATH — verify code actually reads DB_PATH.
6. Gap: no Cloudflare Access policy enforcement noted at app layer — tunnel auth is sole gate; acceptable for single-user, document it.

## Sonnet Response
- 적용 (5): Verified — server/src/index.ts:11 reads `process.env.DB_PATH ?? join(process.cwd(), "cairn.sqlite3")`. DB_PATH env var is honored by the code. Point resolved.
- 적용 (6): Document that Cloudflare Access tunnel auth is the sole access gate (no app-layer policy enforcement), acceptable for single-user deployment. To be reflected in docs/deployment-cloudflare-access.md security boundary section if not already explicit.
- 무시: none. All advisor points are advisory confirmations or doc clarifications, no conflict with plan/user intent.
