---
step: "001"
kind: "approach"
topic: "Deploy artifacts: systemd unit, env example, Caddyfile, deployment doc"
---

1. DB_PATH: use DB_PATH (matches index.ts:11); add spec-drift comment in env.example noting plan said CAIRN_DB_PATH.
2. Caddy v2 SPA: use handle block with try_files {path} /index.html then file_server — not bare try_files outside a route directive.
3. systemd ExecStart: direct node /home/pi/cairn/server/dist/index.js (no start script exists). Add WorkingDirectory, EnvironmentFile, Restart=on-failure.
4. Deployment doc: two headed sections — "Cloudflare dashboard (user-owned/manual)" vs "Repo-managed local config". Access policy stays in dashboard, not repo.
5. env example: HOST=127.0.0.1 (loopback, defense-in-depth behind Caddy) not 0.0.0.0.

All APPLY. No items ignored.
