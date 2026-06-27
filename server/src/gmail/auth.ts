import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createOAuth2Client, type OAuth2Client } from "./client.js";

// Readonly Gmail scope only: this job searches and reads messages, never sends
// or modifies mail. Matches the GCal auth flow but with the Gmail readonly
// scope and the Gmail token store.
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TokenStore = {
  tokenPath: string;
};

export type GmailAuthConfig = {
  clientId: string;
  clientSecret: string;
  tokenPath: string;
};

// Resolve OAuth env into a validated auth config. Throws before any browser/
// network/file work when required credentials are missing, so the thin script
// can exit nonzero deterministically. `cwd` is injectable for tests.
export function resolveGmailAuthConfig(
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd()
): GmailAuthConfig {
  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set.");
  }
  const tokenPath = env.CAIRN_GMAIL_TOKEN_PATH ?? join(cwd, ".cairn", "gmail-token.json");
  return { clientId, clientSecret, tokenPath };
}

export async function runAuth(
  creds: OAuthCredentials,
  store: TokenStore
): Promise<void> {
  const oauth2 = createOAuth2Client(
    creds.clientId,
    creds.clientSecret,
    "http://localhost:3456"
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPE,
    prompt: "consent"
  });

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(url);
  console.log("\nWaiting for OAuth callback on http://localhost:3456 ...\n");

  const code = await waitForCode(3456);
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  await mkdir(join(store.tokenPath, ".."), { recursive: true });
  await writeFile(store.tokenPath, JSON.stringify(tokens, null, 2), "utf8");

  console.log(`\nTokens saved to ${store.tokenPath}`);
}

export async function loadTokens(
  creds: OAuthCredentials,
  store: TokenStore
): Promise<OAuth2Client> {
  const raw = await readFile(store.tokenPath, "utf8");
  const tokens = JSON.parse(raw) as Record<string, unknown>;
  const oauth2 = createOAuth2Client(creds.clientId, creds.clientSecret);
  oauth2.setCredentials(tokens);
  return oauth2;
}

function waitForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      if (code) {
        res.end("Authorization complete. You can close this tab.");
        server.close();
        resolve(code);
      } else {
        res.end("No code received.");
        server.close();
        reject(new Error("No code in OAuth callback"));
      }
    });
    server.listen(port);
    server.on("error", reject);
  });
}
