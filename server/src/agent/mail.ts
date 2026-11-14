import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { google } from "googleapis";
import { createGmailClient, createOAuth2Client, htmlToText, type GmailClient } from "../gmail/client.js";

// Read-only mail for the in-app agent. Nothing here can send, label or delete: the token is
// asked for with the gmail.readonly scope only. The user connects once from the panel, and
// each conversation still has to switch mail reading on.

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Asked for in the same consent, so one approval covers mail and the sheets the user registers.
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEET_ROWS = 150;
const SHEET_CHARS = 5000;
// Google lets an installed-app client redirect to any loopback address. Nothing listens there:
// the user copies the address the browser ends up on back into the panel.
const REDIRECT = "http://localhost:3456";
const BODY_CHARS = 5000;

export type MailSummary = { id: string; from: string; date: string; subject: string; snippet: string };
export type MailFull = MailSummary & { body: string; truncated: boolean };

export type MailAccess = {
  // OAuth client id/secret are present on this server.
  configured(): boolean;
  connected(): boolean;
  authUrl(): string;
  // Takes the code, or the whole address the browser was sent to after consent.
  connect(codeOrUrl: string): Promise<void>;
  disconnect(): void;
  search(query: string, limit: number): Promise<MailSummary[]>;
  read(id: string): Promise<MailFull>;
};

export type SheetTab = { title: string; rows: number; columns: number };
export type SheetRead = { title: string; tab: string; range: string; rows: string[]; truncated: boolean };

// Read-only access to Google Sheets, by spreadsheet id. Which spreadsheets may be read is the
// list the user registered in the panel (agent_sheets), not anything the model names.
export type SheetsAccess = {
  connected(): boolean;
  info(spreadsheetId: string): Promise<{ title: string; tabs: SheetTab[] }>;
  read(spreadsheetId: string, tab?: string, range?: string): Promise<SheetRead>;
};

export function spreadsheetIdOf(input: string): string | null {
  const text = input.trim();
  const inUrl = /\/spreadsheets\/d\/([\w-]{20,})/.exec(text);
  if (inUrl) return inUrl[1]!;
  return /^[\w-]{20,}$/.test(text) ? text : null;
}

export function extractCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).searchParams.get("code");
    } catch {
      return null;
    }
  }
  const inQuery = /(?:^|[?&])code=([^&\s]+)/.exec(text);
  if (inQuery) return decodeURIComponent(inQuery[1]!);
  return /^[\w\-./%]+$/.test(text) ? decodeURIComponent(text) : null;
}

function googleMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/invalid_grant/i.test(text)) return "구글 인증이 만료됐습니다. 메일을 다시 연결하세요";
  if (/has not been used in project|is disabled/i.test(text)) return `구글 클라우드 프로젝트에서 ${/sheets/i.test(text) ? "Google Sheets" : "Gmail"} API 가 꺼져 있습니다. 콘솔에서 켜세요`;
  if (/insufficient.*scope|insufficient authentication/i.test(text)) return "이 권한은 승인되지 않았습니다. Google 을 다시 연결하세요";
  return text.slice(0, 300);
}

function sheetMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return /caller does not have permission|not found/i.test(text) ? "이 계정으로는 열 수 없는 시트입니다" : googleMessage(e);
}

export function createGoogleAccess(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): { mail: MailAccess; sheets: SheetsAccess } {
  // The calendar's OAuth client is reused unless a separate one is given.
  const clientId = env.GMAIL_CLIENT_ID?.trim() || env.GCAL_CLIENT_ID?.trim() || "";
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim() || env.GCAL_CLIENT_SECRET?.trim() || "";
  const tokenPath = env.CAIRN_GMAIL_TOKEN_PATH?.trim()
    || (env.CAIRN_TOKEN_PATH?.trim() ? join(dirname(env.CAIRN_TOKEN_PATH.trim()), "gmail-token.json") : join(cwd, ".cairn", "gmail-token.json"));
  const configured = () => clientId !== "" && clientSecret !== "";

  const granted = (scope: string): boolean => {
    if (!configured() || !existsSync(tokenPath)) return false;
    try {
      const saved = (JSON.parse(readFileSync(tokenPath, "utf8")) as { scope?: unknown }).scope;
      return typeof saved === "string" && saved.split(" ").includes(scope);
    } catch {
      return false;
    }
  };
  const authed = (scope: string, what: string) => {
    if (!granted(scope)) throw new Error(`${what} 연결되지 않았습니다`);
    const oauth = createOAuth2Client(clientId, clientSecret, REDIRECT);
    oauth.setCredentials(JSON.parse(readFileSync(tokenPath, "utf8")) as Record<string, unknown>);
    return oauth;
  };
  const client = (): GmailClient => createGmailClient(authed(SCOPE, "메일이"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheetsApi = () => google.sheets({ version: "v4", auth: authed(SHEETS_SCOPE, "시트가") as any });
  const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

  const summarize = (m: Awaited<ReturnType<GmailClient["getMessage"]>>): MailSummary => ({
    id: m.id, from: m.from ?? "", date: m.date ?? "", subject: m.subject, snippet: m.snippet.slice(0, 300)
  });

  const sheets: SheetsAccess = {
    connected: () => granted(SHEETS_SCOPE),
    async info(spreadsheetId) {
      try {
        const res = await sheetsApi().spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))" });
        return {
          title: res.data.properties?.title ?? "",
          tabs: (res.data.sheets ?? []).map((t) => ({ title: t.properties?.title ?? "", rows: t.properties?.gridProperties?.rowCount ?? 0, columns: t.properties?.gridProperties?.columnCount ?? 0 }))
        };
      } catch (e) {
        throw new Error(sheetMessage(e));
      }
    },
    async read(spreadsheetId, tab, range) {
      const meta = await sheets.info(spreadsheetId);
      const chosen = tab ?? meta.tabs[0]?.title ?? "";
      if (!meta.tabs.some((t) => t.title === chosen)) throw new Error(`'${chosen}' 탭이 없습니다. 탭: ${meta.tabs.map((t) => t.title).join(", ")}`);
      const cells = range && /^[A-Za-z]{1,3}\d{0,6}(:[A-Za-z]{1,3}\d{0,6})?$/.test(range) ? range.toUpperCase() : `A1:Z${SHEET_ROWS}`;
      try {
        const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId, range: `${quoteTab(chosen)}!${cells}` });
        const first = Number(/\d+/.exec(cells)?.[0] ?? 1);
        const all = (res.data.values ?? []) as unknown[][];
        const rows: string[] = [];
        let used = 0;
        let truncated = all.length > SHEET_ROWS;
        for (const [i, row] of all.slice(0, SHEET_ROWS).entries()) {
          if (row.every((c) => String(c ?? "").trim() === "")) continue;
          const line = `${first + i}\t${row.map((c) => String(c ?? "").replace(/\s+/g, " ").slice(0, 200)).join("\t")}`;
          if (used + line.length > SHEET_CHARS) {
            truncated = true;
            break;
          }
          used += line.length;
          rows.push(line);
        }
        return { title: meta.title, tab: chosen, range: cells, rows, truncated };
      } catch (e) {
        throw new Error(sheetMessage(e));
      }
    }
  };

  const mail: MailAccess = {
    configured,
    connected: () => granted(SCOPE),
    authUrl() {
      if (!configured()) throw new Error("이 서버에 구글 OAuth 클라이언트가 설정되지 않았습니다");
      return createOAuth2Client(clientId, clientSecret, REDIRECT).generateAuthUrl({ access_type: "offline", scope: [SCOPE, SHEETS_SCOPE], prompt: "consent" });
    },
    async connect(codeOrUrl) {
      const code = extractCode(codeOrUrl);
      if (!code) throw new Error("주소에서 인증 코드를 찾지 못했습니다. 승인 뒤 이동한 주소 전체를 붙여 넣으세요");
      const oauth = createOAuth2Client(clientId, clientSecret, REDIRECT);
      let tokens: Record<string, unknown>;
      try {
        tokens = (await oauth.getToken(code)).tokens as Record<string, unknown>;
      } catch (e) {
        throw new Error(`구글이 코드를 받지 않았습니다: ${googleMessage(e)}`);
      }
      const scope = typeof tokens.scope === "string" ? tokens.scope : "";
      if (!scope.includes(SCOPE) && !scope.includes(SHEETS_SCOPE)) throw new Error("읽기 권한이 승인되지 않았습니다. 승인 화면에서 Gmail 보기와 스프레드시트 보기를 체크하세요");
      mkdirSync(dirname(tokenPath), { recursive: true });
      writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
    },
    disconnect() {
      rmSync(tokenPath, { force: true });
    },
    async search(query, limit) {
      try {
        const gmail = client();
        const refs = await gmail.searchMessages(query, limit);
        return (await Promise.all(refs.map((r) => gmail.getMessage(r.id)))).map(summarize);
      } catch (e) {
        throw new Error(googleMessage(e));
      }
    },
    async read(id) {
      try {
        const m = await client().getMessage(id);
        const text = (m.body.trim() ? (/<html|<body|<div|<table/i.test(m.body) ? htmlToText(m.body) : m.body) : (m.htmlText ?? "")).replace(/\n{3,}/g, "\n\n").trim();
        return { ...summarize(m), body: text.slice(0, BODY_CHARS), truncated: text.length > BODY_CHARS };
      } catch (e) {
        throw new Error(googleMessage(e));
      }
    }
  };
  return { mail, sheets };
}

export function createMailAccess(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): MailAccess {
  return createGoogleAccess(env, cwd).mail;
}
