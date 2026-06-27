import { join } from "node:path";
import type { SqliteConnection } from "../db/index.js";
import type { GmailClient } from "../gmail/client.js";
import { applyGmailCostEvidence, findGmailCostCandidateEvents } from "../repositories/events.js";
import { extractGmailCostEvidence, type GmailCostEvidence } from "./gmail-cost-parser.js";
import { rfc3339ToMs } from "../utils/rfc3339.js";

export type GmailCostSyncOptions = {
  connection: SqliteConnection;
  client: GmailClient;
  // Deterministic clock for local/test runs (CAIRN_GMAIL_NOW). Defaults to wall clock.
  now?: string;
  // CAIRN_GMAIL_LOOKAHEAD_DAYS, default 14.
  lookaheadDays?: number;
  // Bounded Gmail results fetched per candidate event.
  messagesPerEvent?: number;
};

export type GmailCostSyncResult = {
  scanned: number;
  messages: number;
  updated: number;
  skipped: number;
};

const DEFAULT_LOOKAHEAD_DAYS = 14;
const DEFAULT_MESSAGES_PER_EVENT = 10;

// Generic single-word titles that would make a Gmail search over-match. A
// candidate whose title carries no distinctive token is skipped rather than
// risk writing a wrong cost from an unrelated thread.
const GENERIC_TITLE_TOKENS = new Set([
  "영화", "예약", "약속", "모임", "행사", "일정", "미팅", "회의", "점심", "저녁", "예매", "공연"
]);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toGmailDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
}

// Bounded per-event Gmail query: distinctive title tokens AND a
// cancellation/refund keyword, constrained to a date window ending just after
// the event. Returns null when the title has no distinctive token.
export function buildEventQuery(event: { title: string; start: string | null }): string | null {
  if (!event.start) return null;
  const startMs = rfc3339ToMs(event.start);
  if (Number.isNaN(startMs)) return null;

  const tokens = event.title
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !GENERIC_TITLE_TOKENS.has(t));
  if (tokens.length === 0) return null;

  const after = toGmailDate(startMs - 90 * 24 * 60 * 60 * 1000);
  const before = toGmailDate(startMs + 2 * 24 * 60 * 60 * 1000);
  const titleClause = tokens.map((t) => `"${t}"`).join(" OR ");
  return `(${titleClause}) (취소 OR 환불 OR 위약금 OR 수수료) after:${after} before:${before}`;
}

// One-shot, manual Gmail cancellation-cost sync. Scans imminent external GCal
// events, reads Gmail with a bounded per-event query, and fills only empty cost
// fields with high-confidence deterministic evidence. Gmail API errors abort
// the job and never produce a partial write for the in-flight event.
export async function runGmailCostSync(opts: GmailCostSyncOptions): Promise<GmailCostSyncResult> {
  const { connection, client } = opts;
  const now = opts.now ?? new Date().toISOString();
  const lookaheadDays = opts.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS;
  const limit = opts.messagesPerEvent ?? DEFAULT_MESSAGES_PER_EVENT;

  const candidates = findGmailCostCandidateEvents(connection.db, now, lookaheadDays);
  let messages = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of candidates) {
    const query = buildEventQuery(event);
    if (query === null) {
      skipped++;
      continue;
    }

    const refs = await client.searchMessages(query, limit);
    // Deterministic processing order so multi-message evidence selection is stable.
    const ordered = [...refs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const merged: GmailCostEvidence = {};
    for (const ref of ordered) {
      const msg = await client.getMessage(ref.id);
      messages++;
      const text = `${msg.subject}\n${msg.snippet}\n${msg.body}`;
      const ev = extractGmailCostEvidence(text, event.start ?? "");
      // First high-confidence evidence wins per field (stable by sorted id).
      if (merged.cancelMoney === undefined && ev.cancelMoney !== undefined) {
        merged.cancelMoney = ev.cancelMoney;
      }
      if (merged.refundCutoff === undefined && ev.refundCutoff !== undefined) {
        merged.refundCutoff = ev.refundCutoff;
      }
      if (merged.cancelMoney !== undefined && merged.refundCutoff !== undefined) break;
    }

    if (merged.cancelMoney === undefined && merged.refundCutoff === undefined) {
      skipped++;
      continue;
    }

    const res = applyGmailCostEvidence(connection.db, event.id, merged, now);
    if (res.updatedMoney || res.updatedCutoff) {
      updated++;
    } else {
      skipped++;
    }
  }

  return { scanned: candidates.length, messages, updated, skipped };
}

export type GmailCostSyncConfig = {
  dbPath: string;
  clientId: string;
  clientSecret: string;
  tokenPath: string;
  lookaheadDays: number;
  now?: string;
};

// Resolve env into a validated sync config. Throws before any DB access when
// required env is missing, so the thin script exits nonzero before opening the
// SQLite file. `cwd` is injectable for tests. An invalid/<=0 lookahead falls
// back to the default rather than failing the run.
export function resolveGmailCostSyncConfig(
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd()
): GmailCostSyncConfig {
  const dbPath = env.CAIRN_DB_PATH;
  if (!dbPath) throw new Error("CAIRN_DB_PATH must be set.");
  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set.");
  }
  const tokenPath = env.CAIRN_GMAIL_TOKEN_PATH ?? join(cwd, ".cairn", "gmail-token.json");
  const parsedLookahead = Number.parseInt(env.CAIRN_GMAIL_LOOKAHEAD_DAYS ?? "", 10);
  const lookaheadDays =
    Number.isFinite(parsedLookahead) && parsedLookahead > 0 ? parsedLookahead : DEFAULT_LOOKAHEAD_DAYS;

  const config: GmailCostSyncConfig = { dbPath, clientId, clientSecret, tokenPath, lookaheadDays };
  if (env.CAIRN_GMAIL_NOW) config.now = env.CAIRN_GMAIL_NOW;
  return config;
}
