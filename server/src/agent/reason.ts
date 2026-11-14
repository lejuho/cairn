import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { asc, inArray, isNull, sql } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { agentReasonMessages } from "../db/schema.js";

// The in-app agent's seat on Reason Network: other agents reach it as "<person>/cairn".
// The CLI hands each message over exactly once, so whatever it returns is written to the
// database first and read from there. Collecting messages never calls a model.

export type ReasonIncoming = { messageId: string; from: string; agent: string; text: string };
export type ReasonSession = { address: string; agent: string; status: string; machine: string; repo: string | null; doing: string | null };

export type ReasonClient = {
  session: string;
  available(): boolean;
  // Takes whatever is waiting for this session (and keeps the session registered).
  collect(): Promise<ReasonIncoming[]>;
  team(): Promise<ReasonSession[]>;
  send(to: string, message: string, replyTo?: string): Promise<string>;
};

const TIMEOUT_MS = 20_000;
// Resident workers own these names; listening as them would take their mail.
const RESERVED = new Set(["pi-codex", "pi-claude", "pi-claude-6", "dots"]);

function run(bin: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Only `send` reads stdin. A closed pipe must never take the server down with it.
    const child = spawn(bin, args, { cwd: homedir(), stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Reason Network 응답 시간이 초과됐습니다"));
    }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out).trim().split("\n").slice(-2).join(" ").slice(0, 300) || `exit ${code}`));
    });
    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    }
  });
}

export function parseReasonOutput(output: string): ReasonIncoming[] {
  const found: ReasonIncoming[] = [];
  for (const match of output.matchAll(/<reason-message\s+([^>]*)>([\s\S]*?)<\/reason-message>/g)) {
    const attrs = Object.fromEntries([...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    const text = (match[2] ?? "").trim();
    if (!attrs.from || !attrs.id || !text) continue;
    found.push({ messageId: attrs.id, from: attrs.from, agent: attrs.agent ?? "", text });
  }
  return found;
}

export function createReasonClient(env: NodeJS.ProcessEnv = process.env): ReasonClient {
  const bin = env.CAIRN_REASON_BIN?.trim() || join(homedir(), ".reason/bin/reason-network");
  const session = env.CAIRN_REASON_SESSION?.trim() || "cairn";
  const usable = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(session) && !RESERVED.has(session);
  return {
    session,
    available: () => usable && existsSync(bin),
    async collect() {
      const all: ReasonIncoming[] = [];
      // One call returns what is waiting; a second pass catches anything that arrived meanwhile.
      for (let i = 0; i < 5; i++) {
        const batch = parseReasonOutput(await run(bin, ["listen", "--as", session, "--wait", "0"]));
        if (batch.length === 0) break;
        all.push(...batch);
      }
      return all;
    },
    async team() {
      const parsed = JSON.parse(await run(bin, ["who", "--json"])) as { sessions?: Array<Record<string, unknown>> };
      return (parsed.sessions ?? []).flatMap((s) => (typeof s.address === "string" && s.name !== session
        ? [{
            address: s.address, agent: String(s.agent ?? ""), status: String(s.status ?? ""), machine: String(s.machine ?? ""),
            repo: typeof s.repo === "string" ? s.repo : null, doing: typeof s.doing === "string" ? s.doing : null
          }]
        : []));
    },
    async send(to, message, replyTo) {
      const out = await run(bin, ["send", to, "--from", session, ...(replyTo ? ["--reply-to", replyTo] : []), "-"], message);
      return out.trim().split("\n")[0]?.slice(0, 200) ?? "";
    }
  };
}

export function storeIncoming(db: CairnDatabase, messages: ReasonIncoming[], nowIso: string): number {
  let added = 0;
  for (const m of messages) {
    const result = db.insert(agentReasonMessages)
      .values({ messageId: m.messageId, sender: m.from, senderAgent: m.agent, body: m.text, receivedAt: nowIso })
      .onConflictDoNothing({ target: agentReasonMessages.messageId })
      .run();
    added += result.changes;
  }
  return added;
}

export function unreadCount(db: CairnDatabase): number {
  return db.select({ n: sql<number>`count(*)` }).from(agentReasonMessages).where(isNull(agentReasonMessages.readAt)).get()?.n ?? 0;
}

export type StoredReasonMessage = { id: number; messageId: string; from: string; agent: string; text: string; receivedAt: string };

export function listUnread(db: CairnDatabase, limit = 20): StoredReasonMessage[] {
  return db.select().from(agentReasonMessages).where(isNull(agentReasonMessages.readAt)).orderBy(asc(agentReasonMessages.id)).limit(limit).all()
    .map((r) => ({ id: r.id, messageId: r.messageId, from: r.sender, agent: r.senderAgent, text: r.body, receivedAt: r.receivedAt }));
}

export function markRead(db: CairnDatabase, ids: number[], nowIso: string): void {
  if (ids.length === 0) return;
  db.update(agentReasonMessages).set({ readAt: nowIso }).where(inArray(agentReasonMessages.id, ids)).run();
}

// Collects on a timer so the session stays registered and nothing waits in the daemon's queue.
export function startReasonCollector(db: CairnDatabase, client: ReasonClient, log: (message: string) => void, intervalMs = 60_000): () => void {
  if (!client.available()) return () => undefined;
  let busy = false;
  let lastError = "";
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const added = storeIncoming(db, await client.collect(), new Date().toISOString());
      if (added > 0) log(`reason: ${added} new message(s) for ${client.session}`);
      lastError = "";
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== lastError) log(`reason: collect failed — ${message}`);
      lastError = message;
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
