# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Production migration command targets the wrong SQLite path
- 위치: `deploy/env/cairn-server.env.example:10`, `docs/deployment-cloudflare-access.md:51`, `docs/deployment-cloudflare-access.md:95`, `server/drizzle.config.ts:8`, `server/src/index.ts:11`
- 분석: The production env example configures `DB_PATH=/home/pi/cairn-data/cairn.sqlite3`, and the Fastify runtime reads `process.env.DB_PATH`. However, Drizzle migration config reads `process.env.CAIRN_DB_PATH`, while the deployment guide runs `corepack pnpm db:migrate` without exporting `CAIRN_DB_PATH`. Following the guide would migrate the default `cairn.sqlite3` path instead of the production DB used by systemd.
- 영향: Violates the Sprint Contract requirement that production DB path lives outside the repo and that deploy docs provide a repeatable build/migrate/restart procedure. This can leave the actual production DB unmigrated while creating or mutating a different local SQLite file.
- 수정 방향: Make the production env and deploy commands unambiguous. Either add `CAIRN_DB_PATH=/home/pi/cairn-data/cairn.sqlite3` to the env example and deployment commands, or update Drizzle config to also honor `DB_PATH` consistently. Then update README, deployment doc, and codebase map so runtime and migration DB path guidance matches.

## Sprint Contract Check
- Deployment artifacts exist and are internally consistent: BLOCKED by ISSUE-1
- systemd starts `server/dist/index.js` after build: PASS
- env example binds `HOST=127.0.0.1`, `PORT=3100`, and places DB outside repo: PARTIAL, but migration env mismatch blocks deployment repeatability
- Caddy serves `web/dist`, proxies `/api/*` and `/health`, and falls back to `/index.html`: PASS
- Deployment guide names `cairn.lee-blog.me` and separates user-owned Cloudflare dashboard work: PASS
- README has concise Korean production run/deploy guidance: BLOCKED by ISSUE-1 in production migrate command
- `docs/codebase-map.md` lists deploy artifacts and runtime boundary: PASS
- No Docker files introduced: PASS
- No app-level auth implied as complete: PASS
- No real secret values committed: PASS

## Automatic Checks
- `corepack pnpm verify`: PASS
- `git diff --check`: PASS

## Changes Outside Plan
None found.

## Review Notes
- Artifact enumeration found only `deploy/systemd`, `deploy/env`, and
  `deploy/caddy` examples.
- Docker boundary check found no Docker files.
- Secret search found placeholders only.
- Manual systemd/Caddy/Cloudflare smoke was not executed because it requires
  machine-level service installation and dashboard work; the plan only requires
  documenting those checks.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY

### Applied
RESOLVED: ISSUE-1 — CAIRN_DB_PATH 추가로 Drizzle migration과 Fastify runtime DB 경로 일치
- `deploy/env/cairn-server.env.example`: `CAIRN_DB_PATH=/home/pi/cairn-data/cairn.sqlite3` 추가 (DB_PATH와 함께 — 두 변수가 같은 파일을 가리켜야 함을 주석으로 명시)
- `docs/deployment-cloudflare-access.md:95`: `corepack pnpm db:migrate` → `CAIRN_DB_PATH=... corepack pnpm db:migrate`; 환경파일 편집 안내에도 CAIRN_DB_PATH 언급
- `README.md`: 프로덕션 배포 섹션 migrate 명령에 `CAIRN_DB_PATH=...` 명시
- `docs/codebase-map.md`: env 설명에 DB_PATH(Fastify)와 CAIRN_DB_PATH(Drizzle) 구분 명시
자동 체크: verify ✅ / git diff --check ✅
