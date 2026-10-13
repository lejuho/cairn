#!/usr/bin/env node
// 원격 MCP 커넥터 (ChatGPT·Grok 등). Cloudflare 터널 → 이 프로세스 → 로컬 Cairn API.
// 외부에는 inbox 계열 도구만 노출하고, 일정 수정·삭제 같은 CRUD 는 열지 않는다.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { readApiConfig } from "./api.js";
import type { JsonObject } from "./json.js";
import { CORS, header, json, OAuthServer, readBody, type Grant } from "./oauth.js";
import { CairnMcpServer } from "./server.js";
import { TOOLS, type McpTool } from "./tools.js";

const TOOL_SCOPES: Record<string, string> = {
  cairn_context_now: "cairn.read",
  cairn_inbox: "cairn.read",
  cairn_threads_list: "cairn.read",
  cairn_check_feasibility: "cairn.read",
  cairn_propose_event: "cairn.confirm",
  cairn_pin_route: "cairn.confirm",
  cairn_confirm: "cairn.confirm",
  cairn_observe: "cairn.confirm"
};

const REMOTE_INSTRUCTIONS =
  "Cairn is the user's context/priority hub (schedule, threads = purposes/projects, pending questions) and the single judge of whether an event fits the user's day. " +
  "When the user talks about plans, priorities or what to do next, call cairn_context_now first. " +
  "If it returns pending inbox items, ask at most one relevant question naturally, without interrupting the user's task. " +
  "When you find an event (mail, X, Luma, conversation) with a concrete time, call cairn_propose_event with structured fields and the source URL; if alreadyKnown is true, do not ask again. " +
  "For 'can I make it?' questions call cairn_check_feasibility. Never estimate travel time yourself: relay Cairn's verdict, reasons and assumptions. " +
  "Follow analysisRequests: for route_check, check the route live (naverUrl) and tell the user the route; for origin_check, ask where they will be. " +
  "Do not store route details anywhere; only if the user confirms a duration, record it with cairn_pin_route. " +
  "Record only answers the user actually gave with cairn_confirm (never guess an accept). Use cairn_observe for decisions or commitments without a concrete time.";

export function toolsForScopes(scopes: string[]): McpTool[] {
  return TOOLS.filter((t) => {
    const need = TOOL_SCOPES[t.name];
    return need !== undefined && scopes.includes(need);
  });
}

/** 답·관찰 기록에 어느 커넥터가 남겼는지 서버가 강제로 박는다 (클라이언트 자가 신고 무시). */
export function argsForGrant(grant: Grant) {
  const label = `remote:${grant.clientName}`.slice(0, 100);
  return (name: string, args: JsonObject): JsonObject => {
    if (name === "cairn_confirm") return { ...args, answeredBy: label };
    if (name === "cairn_observe") return { ...args, agent: label };
    if (name === "cairn_propose_event") return { ...args, proposedBy: label };
    return args;
  };
}

export function createRemoteHandler(oauth: OAuthServer) {
  const apiConfig = readApiConfig();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (await oauth.handle(req, res, url)) return;

    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname !== "/mcp") return json(res, 404, { error: "not found" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }

    const grant = oauth.verifyAccessToken(header(req, "authorization").replace(/^Bearer\s+/i, ""));
    if (!grant) {
      return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": oauth.wwwAuthenticate() });
    }
    // Streamable HTTP 중 서버→클라이언트 SSE 스트림은 지원하지 않는다 (요청-응답만).
    if (req.method === "GET") {
      res.writeHead(405, { ...CORS, Allow: "POST" }).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, CORS).end();
      return;
    }

    const server = new CairnMcpServer(apiConfig, {
      tools: toolsForScopes(grant.scope),
      argsFor: argsForGrant(grant),
      instructions: REMOTE_INSTRUCTIONS
    });
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const responses = [];
    for (const m of messages) {
      const r = await server.handleLine(JSON.stringify(m));
      if (r) responses.push(r);
    }
    if (!responses.length) {
      res.writeHead(202, CORS).end();
      return;
    }
    console.log(`[mcp] ${grant.clientName} ${messages.map((m) => (m as { method?: string; params?: { name?: string } }).params?.name ?? (m as { method?: string }).method).join(",")}`);
    return json(res, 200, Array.isArray(parsed) ? responses : responses[0]);
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? "https://cairn-mcp.lee-blog.me").replace(/\/$/, "");
  const storePath = process.env.OAUTH_STORE_PATH ?? "/home/pi/cairn-data/mcp-oauth.json";
  const port = Number(process.env.REMOTE_MCP_PORT ?? 8792);
  const host = process.env.REMOTE_MCP_HOST ?? "0.0.0.0";
  const handler = createRemoteHandler(new OAuthServer(baseUrl, storePath));
  createServer((req, res) => {
    handler(req, res).catch((e: unknown) => {
      console.error("[remote]", e);
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  }).listen(port, host, () => console.log(`cairn remote MCP on ${host}:${port} (${baseUrl})`));
}
