import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export type GmailMessageRef = { id: string };

export type GmailMessage = {
  id: string;
  subject: string;
  snippet: string;
  body: string;
};

// Read-only Gmail surface used by the cost-sync job. Tests use fake
// implementations of this interface; no real network access in CI.
export type GmailClient = {
  searchMessages(query: string, limit: number): Promise<GmailMessageRef[]>;
  getMessage(id: string): Promise<GmailMessage>;
};

export function createOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri = "http://localhost:0"
): OAuth2Client {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createGmailClient(auth: OAuth2Client): GmailClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = google.gmail({ version: "v1", auth: auth as any });

  return {
    async searchMessages(query, limit): Promise<GmailMessageRef[]> {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: limit
      });
      return (res.data.messages ?? [])
        .filter((m): m is { id: string } => typeof m.id === "string")
        .map((m) => ({ id: m.id }));
    },
    async getMessage(id): Promise<GmailMessage> {
      const res = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full"
      });
      return extractMessage(res.data);
    }
  };
}

function extractMessage(msg: gmail_v1.Schema$Message): GmailMessage {
  const headers = msg.payload?.headers ?? [];
  const subject =
    headers.find((h) => (h.name ?? "").toLowerCase() === "subject")?.value ?? "";
  return {
    id: msg.id ?? "",
    subject,
    snippet: msg.snippet ?? "",
    body: extractPlainText(msg.payload)
  };
}

// Walk the MIME tree collecting text/plain parts. Falls back to the top-level
// body when no multipart text/plain part exists. HTML parts are ignored — the
// deterministic parser only needs plain text and snippet.
function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const chunks: string[] = [];
  const walk = (part: gmail_v1.Schema$MessagePart): void => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      chunks.push(decodeBase64Url(part.body.data));
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(payload);
  if (chunks.length === 0 && payload.body?.data) {
    chunks.push(decodeBase64Url(payload.body.data));
  }
  return chunks.join("\n");
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}
