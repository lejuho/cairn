// OAuth 2.1 인가 서버 (원격 MCP 커넥터용) — macro-obs src/oauth.js 이식, 의존성 제로.
// RFC 9728 보호 리소스 메타데이터, RFC 8414 AS 메타데이터, RFC 7591 동적 등록, PKCE S256 필수,
// refresh token 회전. 승인 화면은 Cloudflare Access 뒤에 두고 서버가 Access JWT 를 직접 검증한다.
// 단일 사용자·소수 클라이언트라 상태는 JSON 파일 하나 (토큰·코드·시크릿은 sha256 해시만 저장).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyAccessJwt } from "./cf-access.js";

const ACCESS_TTL = 3600;
const REFRESH_TTL = 90 * 86400;
const CODE_TTL = 300;
const PENDING_TTL_MS = 600_000;
const MAX_CLIENTS = 100;

export const SCOPES = ["cairn.read", "cairn.confirm"] as const;
const SCOPE_LABEL: Record<string, string> = {
  "cairn.read": "지금 맥락·확인 대기 질문·thread 목록 읽기",
  "cairn.confirm": "질문에 대한 답 기록, 대화 중 관찰 기록 (일정 수정·삭제 불가)"
};

type Client = { clientId: string; secretHash: string | null; name: string; redirectUris: string[]; createdAt: number };
type Code = { codeHash: string; clientId: string; redirectUri: string; challenge: string; scope: string; owner: string; expiresAt: number };
type Token = { tokenHash: string; kind: "access" | "refresh"; clientId: string; scope: string; owner: string; expiresAt: number; revoked?: boolean };
type Store = { clients: Client[]; codes: Code[]; tokens: Token[] };
type Pending = { clientId: string; clientName: string; redirectUri: string; state: string | null; challenge: string; scope: string; owner: string; at: number };

export type Grant = { clientId: string; clientName: string; scope: string[]; owner: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rand = (n = 32) => randomBytes(n).toString("base64url");
const nowSec = () => Math.floor(Date.now() / 1000);

export class OAuthServer {
  private store: Store;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly baseUrl: string,
    private readonly storePath: string,
    private readonly verifyOwner: (req: IncomingMessage) => Promise<string> = (req) =>
      verifyAccessJwt(header(req, "cf-access-jwt-assertion")).then((r) => r.email)
  ) {
    this.store = existsSync(storePath)
      ? (JSON.parse(readFileSync(storePath, "utf8")) as Store)
      : { clients: [], codes: [], tokens: [] };
  }

  get resourceUrl(): string {
    return `${this.baseUrl}/mcp`;
  }

  wwwAuthenticate(): string {
    return `Bearer resource_metadata="${this.baseUrl}/.well-known/oauth-protected-resource"`;
  }

  verifyAccessToken(token: string): Grant | null {
    if (!token) return null;
    const h = sha(token);
    const row = this.store.tokens.find((t) => t.tokenHash === h && t.kind === "access" && !t.revoked && t.expiresAt > nowSec());
    if (!row) return null;
    const client = this.store.clients.find((c) => c.clientId === row.clientId);
    return { clientId: row.clientId, clientName: client?.name || row.clientId, scope: row.scope.split(" "), owner: row.owner };
  }

  /** /.well-known/oauth-* 또는 /oauth/* 이면 처리하고 true. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith("/oauth/") && !path.startsWith("/.well-known/oauth-") && path !== "/.well-known/openid-configuration") {
      return false;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return true;
    }
    try {
      if (path.startsWith("/.well-known/oauth-protected-resource")) json(res, 200, this.resourceMetadata());
      else if (path.startsWith("/.well-known/oauth-authorization-server") || path === "/.well-known/openid-configuration") {
        json(res, 200, this.authServerMetadata());
      } else if (path === "/oauth/authorize") await this.authorize(req, res, url);
      else if (path === "/oauth/token") await this.token(req, res);
      else if (path === "/oauth/register") await this.register(req, res);
      else if (path === "/oauth/revoke") await this.revoke(req, res);
      else json(res, 404, { error: "not found" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      console.error(`[oauth] ${path}: ${message}`);
      if (!res.headersSent) oerr(res, 400, "invalid_request", message);
    }
    return true;
  }

  private save(): void {
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.store), { mode: 0o600 });
    renameSync(tmp, this.storePath);
  }

  private resourceMetadata() {
    return {
      resource: this.resourceUrl,
      authorization_servers: [this.baseUrl],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "cairn"
    };
  }

  private authServerMetadata() {
    const b = this.baseUrl;
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: SCOPES
    };
  }

  private issueTokens(clientId: string, scope: string, owner: string) {
    const access = rand();
    const refresh = rand();
    const now = nowSec();
    this.store.tokens = this.store.tokens.filter((t) => t.expiresAt > now);
    this.store.codes = this.store.codes.filter((c) => c.expiresAt > now);
    this.store.tokens.push(
      { tokenHash: sha(access), kind: "access", clientId, scope, owner, expiresAt: now + ACCESS_TTL },
      { tokenHash: sha(refresh), kind: "refresh", clientId, scope, owner, expiresAt: now + REFRESH_TTL }
    );
    this.save();
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope };
  }

  private async authorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    let owner: string;
    try {
      owner = await this.verifyOwner(req);
    } catch (e) {
      return html(res, 403, `<h1>승인 불가</h1><p>${esc(e instanceof Error ? e.message : "")}</p>`);
    }

    if (req.method === "GET") {
      const p = Object.fromEntries(url.searchParams);
      const client = this.store.clients.find((c) => c.clientId === p.client_id);
      if (!client) return html(res, 400, "<h1>잘못된 요청</h1><p>알 수 없는 client_id</p>");
      const redirectUri = p.redirect_uri || (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
      if (!client.redirectUris.includes(redirectUri)) return html(res, 400, "<h1>잘못된 요청</h1><p>등록되지 않은 redirect_uri</p>");
      const back = (error: string, desc?: string) => {
        const u = new URL(redirectUri);
        u.searchParams.set("error", error);
        if (desc) u.searchParams.set("error_description", desc);
        if (p.state) u.searchParams.set("state", p.state);
        res.writeHead(302, { Location: u.toString() }).end();
      };
      if (p.response_type !== "code") return back("unsupported_response_type");
      if (!p.code_challenge || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE S256 required");
      const resource = p.resource?.replace(/\/$/, "");
      if (resource && resource !== this.resourceUrl && resource !== this.baseUrl) return back("invalid_target");

      for (const [k, v] of this.pending) if (v.at < Date.now() - PENDING_TTL_MS) this.pending.delete(k);
      const rid = rand(24);
      // 요청 범위와 무관하게 두 스코프 모두 부여 — 둘 다 좁은 권한이고, 답 기록이 커넥터의 목적.
      const scope = SCOPES.join(" ");
      this.pending.set(rid, { clientId: client.clientId, clientName: client.name, redirectUri, state: p.state ?? null, challenge: p.code_challenge, scope, owner, at: Date.now() });
      return html(res, 200, `<h1>Cairn 연결 승인</h1>
<dl><dt>앱</dt><dd>${esc(client.name || "(이름 없음)")}</dd>
<dt>돌아갈 주소</dt><dd>${esc(new URL(redirectUri).origin)}</dd>
<dt>권한</dt><dd>${scope.split(" ").map((s) => esc(SCOPE_LABEL[s] ?? s)).join("<br>")}</dd>
<dt>승인자</dt><dd>${esc(owner)}</dd></dl>
<form method="post" action="/oauth/authorize"><input type="hidden" name="rid" value="${rid}">
<button class="ok" name="decision" value="approve">승인</button><button name="decision" value="deny">거부</button></form>`);
    }

    if (req.method === "POST") {
      const p = parseForm(req, await readBody(req));
      const pend = this.pending.get(String(p.rid ?? ""));
      this.pending.delete(String(p.rid ?? ""));
      if (!pend || pend.at < Date.now() - PENDING_TTL_MS || pend.owner !== owner) {
        return html(res, 400, "<h1>만료된 요청</h1><p>앱에서 연결을 다시 시작하세요.</p>");
      }
      const u = new URL(pend.redirectUri);
      if (pend.state) u.searchParams.set("state", pend.state);
      if (p.decision !== "approve") {
        u.searchParams.set("error", "access_denied");
      } else {
        const code = rand();
        this.store.codes.push({ codeHash: sha(code), clientId: pend.clientId, redirectUri: pend.redirectUri, challenge: pend.challenge, scope: pend.scope, owner, expiresAt: nowSec() + CODE_TTL });
        this.save();
        u.searchParams.set("code", code);
        console.log(`[oauth] grant client=${pend.clientName} scope=${pend.scope}`);
      }
      u.searchParams.set("iss", this.baseUrl);
      res.writeHead(302, { Location: u.toString() }).end();
      return;
    }
    res.writeHead(405).end();
  }

  private clientAuth(req: IncomingMessage, p: Record<string, string>): Client | null {
    let id = p.client_id;
    let secret = p.client_secret;
    const basic = header(req, "authorization").match(/^Basic\s+(.+)$/i);
    if (basic) {
      const [u, s] = Buffer.from(basic[1]!, "base64").toString().split(":");
      id = decodeURIComponent(u ?? "");
      secret = decodeURIComponent(s ?? "");
    }
    const client = this.store.clients.find((c) => c.clientId === id);
    if (!client) return null;
    if (client.secretHash) {
      if (!secret) return null;
      const a = Buffer.from(sha(secret));
      const b = Buffer.from(client.secretHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    }
    return client;
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return oerr(res, 405, "invalid_request");
    const p = parseForm(req, await readBody(req));
    const client = this.clientAuth(req, p);
    if (!client) return oerr(res, 401, "invalid_client");

    if (p.grant_type === "authorization_code") {
      const h = sha(String(p.code ?? ""));
      const row = this.store.codes.find((c) => c.codeHash === h);
      // 1회용 — 조회와 동시에 삭제.
      this.store.codes = this.store.codes.filter((c) => c.codeHash !== h);
      this.save();
      if (!row || row.expiresAt < nowSec() || row.clientId !== client.clientId) return oerr(res, 400, "invalid_grant");
      if (p.redirect_uri && p.redirect_uri !== row.redirectUri) return oerr(res, 400, "invalid_grant", "redirect_uri mismatch");
      const challenge = createHash("sha256").update(String(p.code_verifier ?? "")).digest("base64url");
      if (!p.code_verifier || challenge !== row.challenge) return oerr(res, 400, "invalid_grant", "PKCE verification failed");
      return json(res, 200, this.issueTokens(client.clientId, row.scope, row.owner));
    }
    if (p.grant_type === "refresh_token") {
      const h = sha(String(p.refresh_token ?? ""));
      const row = this.store.tokens.find((t) => t.tokenHash === h && t.kind === "refresh" && !t.revoked && t.expiresAt > nowSec());
      if (!row || row.clientId !== client.clientId) return oerr(res, 400, "invalid_grant");
      row.revoked = true;
      const asked = p.scope ? String(p.scope).split(/\s+/).filter((s) => row.scope.split(" ").includes(s)).join(" ") : "";
      return json(res, 200, this.issueTokens(client.clientId, asked || row.scope, row.owner));
    }
    return oerr(res, 400, "unsupported_grant_type");
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return oerr(res, 405, "invalid_request");
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(await readBody(req, 16 * 1024)) as Record<string, unknown>;
    } catch {
      return oerr(res, 400, "invalid_client_metadata", "JSON required");
    }
    const uris = Array.isArray(p.redirect_uris) ? p.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
      return oerr(res, 400, "invalid_redirect_uri", "https or http://localhost only");
    }
    if (this.store.clients.length >= MAX_CLIENTS) return oerr(res, 400, "invalid_client_metadata", "client limit");
    const method = typeof p.token_endpoint_auth_method === "string" ? p.token_endpoint_auth_method : "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
      return oerr(res, 400, "invalid_client_metadata", `token_endpoint_auth_method ${method}`);
    }
    const clientId = `cn_${rand(16)}`;
    const secret = method === "none" ? null : rand();
    const name = String(p.client_name ?? "").slice(0, 100);
    this.store.clients.push({ clientId, secretHash: secret ? sha(secret) : null, name, redirectUris: uris, createdAt: nowSec() });
    this.save();
    return json(res, 201, {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: nowSec(),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method
    });
  }

  private async revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return oerr(res, 405, "invalid_request");
    const p = parseForm(req, await readBody(req));
    if (p.token) {
      const h = sha(String(p.token));
      for (const t of this.store.tokens) if (t.tokenHash === h) t.revoked = true;
      this.save();
    }
    return json(res, 200, {});
  }
}

// ── HTTP 유틸 ──
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id"
};

export function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function parseForm(req: IncomingMessage, raw: string): Record<string, string> {
  if (header(req, "content-type").includes("application/json")) {
    try {
      return JSON.parse(raw || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function json(res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra });
  res.end(JSON.stringify(body));
}

function oerr(res: ServerResponse, code: number, error: string, description?: string): void {
  console.log(`[oauth] ${code} ${error}${description ? ` — ${description}` : ""}`);
  json(res, code, { error, ...(description ? { error_description: description } : {}) });
}

function validRedirect(u: string): boolean {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === "https:") return true;
    return x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  } catch {
    return false;
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(res: ServerResponse, code: number, body: string): void {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*",
    "Referrer-Policy": "no-referrer"
  });
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cairn 연결 승인</title><style>
:root{--bg:#fafafa;--fg:#1a1a1a;--card:#fff;--line:#ddd;--muted:#666}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--card:#1b1b1b;--line:#333;--muted:#999}}
body{font:15px/1.6 system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:var(--fg);background:var(--bg)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:18px;margin:0 0 12px}dt{color:var(--muted);font-size:13px}dd{margin:0 0 10px;word-break:break-all}
button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;margin-right:8px}
button.ok{background:var(--fg);color:var(--bg);border-color:var(--fg)}
</style></head><body><div class="card">${body}</div></body></html>`);
}
