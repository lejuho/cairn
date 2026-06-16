import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createOAuth2Client, type OAuth2Client } from "./client.js";

const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TokenStore = {
  tokenPath: string;
};

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
