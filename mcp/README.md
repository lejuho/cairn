# Cairn MCP

Local stdio MCP server that exposes Cairn's HTTP API to agents.

Run after build:

```bash
corepack pnpm --filter @cairn/mcp build
CAIRN_API_BASE_URL=http://127.0.0.1:3100 node /home/pi/cairn/mcp/dist/index.js
```

Useful tools:

- `cairn_api_request` calls any `/api/*` route.
- `cairn_route_catalog` lists the wrapped API surface.
- Specific helpers cover Today, items, events, tasks, threads, places, watchers,
  provider status, and scheduling.

Config:

- Codex: `codex mcp add cairn --env CAIRN_API_BASE_URL=http://127.0.0.1:3100 -- node /home/pi/cairn/mcp/dist/index.js`
- MCP clients that read project config: see repo root `.mcp.json`.

The server writes only JSON-RPC messages to stdout. Diagnostics must go to
stderr so MCP framing stays clean.
