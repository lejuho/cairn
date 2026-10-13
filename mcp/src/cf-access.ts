// Cloudflare Access JWT 검증 — macro-obs src/cf-access.js 이식, 의존성 제로 (node:crypto RS256).
// 헤더만 믿지 않고 팀 공개키로 서명·aud·iss·만료·이메일을 직접 검증 → Access 설정이 빠져도 fail closed.
// env: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, OAUTH_OWNER_EMAIL
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

type Jwk = JsonWebKey & { kid?: string };
type KeysFn = (team: string, force?: boolean) => Promise<Jwk[]>;

let certCache: { at: number; keys: Jwk[] } = { at: 0, keys: [] };

async function fetchKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && Date.now() - certCache.at < 3_600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: Jwk[] };
  certCache = { at: Date.now(), keys };
  return keys;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export async function verifyAccessJwt(
  token: string,
  { keysFn = fetchKeys, now = Date.now(), env = process.env }: { keysFn?: KeysFn; now?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ email: string }> {
  const team = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  const owner = (env.OAUTH_OWNER_EMAIL ?? "").toLowerCase();
  if (!team || !aud || !owner) throw new Error("Cloudflare Access 미설정 (CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD/OAUTH_OWNER_EMAIL)");
  if (!token) throw new Error("Cf-Access-Jwt-Assertion 없음 — Access 애플리케이션이 이 경로를 보호하는지 확인");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT 형식");
  const head = JSON.parse(b64url(parts[0]!).toString()) as { alg?: string; kid?: string };
  const payload = JSON.parse(b64url(parts[1]!).toString()) as Record<string, unknown>;
  if (head.alg !== "RS256") throw new Error(`alg ${head.alg}`);

  let keys = await keysFn(team);
  let jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk) {
    keys = await keysFn(team, true);
    jwk = keys.find((k) => k.kid === head.kid);
  }
  if (!jwk) throw new Error("kid 불일치");
  const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64url(parts[2]!));
  if (!ok) throw new Error("서명 불일치");

  const sec = Math.floor(now / 1000);
  if (typeof payload.exp !== "number" || payload.exp < sec) throw new Error("만료");
  if (typeof payload.nbf === "number" && payload.nbf > sec + 60) throw new Error("nbf");
  if (payload.iss !== `https://${team}`) throw new Error(`iss ${String(payload.iss)}`);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("aud 불일치");
  const email = String(payload.email ?? "").toLowerCase();
  if (!email || email !== owner) throw new Error(`허용되지 않은 사용자: ${email || "(서비스 토큰)"}`);
  return { email };
}
