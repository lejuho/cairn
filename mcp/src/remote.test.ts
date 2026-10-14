import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAccessJwt } from "./cf-access.js";
import { OAuthServer } from "./oauth.js";
import { createRemoteHandler, toolsForScopes } from "./remote.js";

const dir = mkdtempSync(join(tmpdir(), "cairn-remote-"));
let server: Server;
let base = "";

beforeAll(async () => {
  const oauth = new OAuthServer("https://cairn-mcp.example", join(dir, "oauth.json"), async () => "owner@example.com");
  const handler = createRemoteHandler(oauth);
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(): Promise<string> {
  const reg = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/cb"] })
  }).then((r) => r.json() as Promise<{ client_id: string }>);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: "https://chatgpt.com/cb", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  const page = await fetch(`${base}/oauth/authorize?${q}`).then((r) => r.text());
  const rid = page.match(/name="rid" value="([^"]+)"/)![1]!;
  const approve = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rid, decision: "approve" })
  });
  const loc = new URL(approve.headers.get("location")!);
  expect(loc.searchParams.get("state")).toBe("s1");
  const tok = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code")!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: "https://chatgpt.com/cb" })
  }).then((r) => r.json() as Promise<{ access_token: string; scope: string }>);
  expect(tok.scope).toBe("cairn.read cairn.confirm");
  return tok.access_token;
}

describe("remote MCP", () => {
  it("advertises OAuth metadata and rejects unauthenticated MCP calls", async () => {
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json() as Promise<{ resource: string }>);
    expect(meta.resource).toBe("https://cairn-mcp.example/mcp");
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("exposes only inbox tools after the OAuth + PKCE flow", async () => {
    const token = await connect();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    }).then((r) => r.json() as Promise<{ result: { tools: { name: string }[] } }>);
    expect(res.result.tools.map((t) => t.name).sort()).toEqual(
      ["cairn_check_feasibility", "cairn_confirm", "cairn_context_now", "cairn_event_capture_check", "cairn_inbox", "cairn_material_attach", "cairn_material_update", "cairn_observe", "cairn_pin_route", "cairn_plan_prep", "cairn_propose_event", "cairn_threads_list"]
    );
    const denied = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cairn_event_status", arguments: { id: 1, status: "cancelled" } } })
    }).then((r) => r.json() as Promise<{ result: { isError: boolean } }>);
    expect(denied.result.isError).toBe(true);
  });

  it("maps scopes to tools", () => {
    expect(toolsForScopes(["cairn.read"]).map((t) => t.name)).not.toContain("cairn_confirm");
  });
});

describe("Cloudflare Access JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const env = { CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUD: "aud1", OAUTH_OWNER_EMAIL: "Owner@Example.com" };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (payload: object) => {
    const head = `${b64({ alg: "RS256", kid: "k1" })}.${b64(payload)}`;
    return `${head}.${sign("RSA-SHA256", Buffer.from(head), privateKey).toString("base64url")}`;
  };
  const opts = { keysFn: async () => [jwk], env };
  const good = { iss: "https://team.cloudflareaccess.com", aud: ["aud1"], email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60 };

  it("accepts the owner and rejects others", async () => {
    await expect(verifyAccessJwt(jwt(good), opts)).resolves.toEqual({ email: "owner@example.com" });
    await expect(verifyAccessJwt(jwt({ ...good, email: "x@example.com" }), opts)).rejects.toThrow("허용되지 않은");
    await expect(verifyAccessJwt(jwt({ ...good, aud: ["other"] }), opts)).rejects.toThrow("aud");
    await expect(verifyAccessJwt("", opts)).rejects.toThrow();
  });
});
