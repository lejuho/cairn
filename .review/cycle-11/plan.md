# Cycle 11 — Production Access Boundary + Local Service Deploy

Branch: `feature/cycle-11-production-access-boundary`
Cycle: `11`
Created: `2026-06-17`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Prepare Cairn for safe Raspberry Pi exposure at `https://cairn.lee-blog.me`
without Docker. The deployment shape is:

```txt
Cloudflare Access + Tunnel
  -> cairn.lee-blog.me
  -> localhost:8080 local reverse proxy
      /api/*  -> localhost:3100 Fastify
      /health -> localhost:3100 Fastify
      /*      -> web/dist static PWA
```

Cloudflare dashboard work is user-owned and out of repo scope. This cycle adds
local production artifacts and docs so the app can run under `systemd`, serve
the built PWA through a local reverse proxy, keep Fastify bound to localhost,
and make redeploy steps repeatable.

Docker remains out of scope. The chosen v1 operations model is simpler:
systemd for the Node server, Caddy as the local static/reverse proxy, and the
existing Pi `cloudflared` tunnel pointing to Caddy.

Out of scope:
- Docker or docker-compose
- Creating or modifying Cloudflare dashboard resources
- Public unauthenticated exposure
- App-level auth implementation
- Multi-user identity
- TLS termination inside the app
- Automatic `git pull` deploy hooks
- Process supervisor replacement beyond systemd
- Database backup automation, except documenting the DB path boundary

## 입력/출력 명세

- Input: existing repo on Raspberry Pi, domain `cairn.lee-blog.me`, existing or
  user-managed Cloudflare Tunnel + Access setup.
- Output: deploy artifacts and docs only:
  - Example systemd unit for the Fastify server.
  - Example environment file for production server config.
  - Example Caddyfile for static PWA serving plus `/api` and `/health` reverse
    proxy.
  - Deployment guide covering build, migrate, restart, smoke checks, and
    Cloudflare Tunnel ingress target.
  - README links/short commands for production operation.
- Runtime behavior target:
  - Fastify listens on `127.0.0.1:3100` unless env overrides.
  - Caddy listens on `127.0.0.1:8080` or `:8080` as documented.
  - Tunnel service points `cairn.lee-blog.me` to `http://localhost:8080`.
  - Web keeps relative `/api` calls; no `VITE_API_BASE_URL`.
  - `/today`, `/threads`, `/threads/new`, and `/threads/:id` work as SPA routes
    from a hard refresh.

## Key Changes

- Deployment artifacts:
  - Add `deploy/systemd/cairn-server.service.example`.
  - Add `deploy/env/cairn-server.env.example`.
  - Add `deploy/caddy/Caddyfile.example`.
  - Use placeholders where machine-specific paths differ, but default examples
    should match `/home/pi/cairn`, `/home/pi/cairn-data/cairn.sqlite3`,
    `127.0.0.1:3100`, and `localhost:8080`.
- Docs:
  - Add `docs/deployment-cloudflare-access.md`.
  - Update `README.md` with a short Korean production section linking to the
    detailed deployment doc.
  - Update `docs/codebase-map.md` with the new deploy artifact locations and
    runtime boundary.
- Server/runtime:
  - Prefer no server code changes.
  - If implementation proves the current server cannot bind localhost through
    `HOST=127.0.0.1`, adjust only the minimal boot/config code and add tests.
  - Do not expose Fastify directly to Cloudflare Tunnel in the recommended path.
- Web/runtime:
  - Prefer no web app code changes.
  - Verify production build emits static assets and service worker as before.
  - Ensure Caddy `try_files` fallback is documented for SPA routes.
- Security boundary:
  - Document that Cloudflare Access must be enabled before public DNS/Tunnel
    exposure is considered acceptable.
  - Document that local mutation APIs remain unauthenticated behind Access.
  - Keep secrets out of repo; examples may use placeholder values only.

## Sprint Contract

- 통과 기준:
  - Deployment artifacts exist and are internally consistent:
    - systemd starts `server/dist/index.js` after build.
    - env example binds `HOST=127.0.0.1`, `PORT=3100`, and sets
      `CAIRN_DB_PATH` outside the repo.
    - Caddy serves `web/dist`, reverse proxies `/api/*` and `/health`, and
      falls back to `/index.html` for SPA routes.
  - Deployment guide names `cairn.lee-blog.me` and clearly separates
    user-owned Cloudflare dashboard work from repo-managed local config.
  - README has concise Korean production run/deploy guidance.
  - `docs/codebase-map.md` lists deploy artifacts and runtime boundary.
  - No Docker files are introduced.
  - No app-level auth is implied as complete.
  - No secret values are committed.
- 자동 체크:
  - `corepack pnpm verify`
  - `git diff --check`
- Manual/smoke checklist to document:
  - `corepack pnpm build`
  - `corepack pnpm db:migrate`
  - `sudo systemctl restart cairn-server`
  - `systemctl status cairn-server`
  - `curl http://127.0.0.1:3100/health`
  - `curl http://localhost:8080/health`
  - Open `https://cairn.lee-blog.me/today` after Cloudflare Access is enabled.
- 테스트 케이스:
  - If no runtime code changes are made, existing automated tests are
    sufficient plus artifact enumeration/review.
  - If server boot/config changes are made, add unit coverage for env host/port
    behavior where practical.
  - If web route serving code changes are made, preserve existing web route
    tests.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Cloudflare Tunnel is pointed directly at `localhost:3100`, bypassing static
  PWA serving and SPA fallback; docs must steer toward `localhost:8080`.
- Server starts from systemd before `corepack pnpm build` has produced
  `server/dist/index.js`; unit should fail loudly and deployment guide must
  order build before restart.
- DB path accidentally lives inside the repo and gets removed/reset during
  development; env example and docs must place it under `/home/pi/cairn-data`.

## 더 단순한 대안 1개

Expose the Vite dev server through Cloudflare Tunnel. It is fast for a local
demo, but it exposes a development server and still leaves mutation APIs behind
only informal protection. The selected plan creates a small production boundary
without introducing Docker.

## Assumptions

- User will configure Cloudflare Access, DNS, and Tunnel dashboard settings.
- Domain is `lee-blog.me`; Cairn subdomain is `cairn.lee-blog.me`.
- Existing Pi already has or can run `cloudflared`.
- Caddy is acceptable as the local reverse proxy/static server for v1.
- Docker is intentionally deferred.
- Single-user Access protection is enough for this cycle; app-level auth waits
  for a later dedicated cycle.
- Production SQLite DB path should be outside the git repo.
- The LLM proxy, Telegram worker, and GCal credentials remain separate local
  env concerns and are not required for the basic production smoke.

## Review Guidance

### Enumeration 필요 항목

- Deployment artifacts:
  - Search: `find deploy -maxdepth 3 -type f -print | sort`
  - Expected: systemd, env, and Caddy examples only; no Docker files.
- Docker boundary:
  - Search: `find . -maxdepth 3 \( -iname '*docker*' -o -name 'docker-compose.yml' -o -name 'Dockerfile' \) -print`
  - Expected: no new Docker deployment files for Cycle 11.
- Secret boundary:
  - Search: `rg -n "TOKEN=|SECRET=|PASSWORD=|BEGIN PRIVATE|cloudflared tunnel token|eyJ" deploy docs README.md`
  - Expected: placeholders only, no real secret material.
- Runtime ports:
  - Search: `rg -n "127.0.0.1:3100|localhost:3100|localhost:8080|cairn.lee-blog.me|web/dist|server/dist" deploy docs README.md`
  - Expected: consistent production boundary.
- Codebase map:
  - Search: `rg -n "deploy|systemd|Caddy|Cloudflare|cairn.lee-blog.me" docs/codebase-map.md`
  - Expected: new deployment artifact locations and boundary documented.

### 검증 방식 가이드

- Artifact consistency can be reviewed with file reads and grep enumeration.
- Existing app behavior must still pass `corepack pnpm verify`.
- Manual smoke commands should be documented, not necessarily executed by
  Cycle Reviewer if they require machine-level service installation.
- If implementation changes runtime code, reviewer must require automated tests
  for that changed behavior.
