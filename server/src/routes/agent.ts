import type { FastifyInstance } from "fastify";
import { AgentChatRequestSchema, AgentConfirmRequestSchema, AgentMailConnectRequestSchema, AgentSheetAddRequestSchema, type AgentSheet, type AgentSources, type AgentStreamEvent } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { AgentTurnError, confirmPending, runTurn } from "../agent/loop.js";
import { createComplete, listProviders, type Complete } from "../agent/providers.js";
import { asc, eq } from "drizzle-orm";
import { agentSheets } from "../db/schema.js";
import { createGoogleAccess, spreadsheetIdOf, type MailAccess, type SheetsAccess } from "../agent/mail.js";
import { createReasonClient, unreadCount, type ReasonClient } from "../agent/reason.js";
import { deleteConversation, getConversation, listConversations } from "../agent/store.js";
import { listEventCandidates } from "../services/inbox.js";
import { isRemoteAudience } from "../utils/audience.js";

export type AgentRouteOptions = {
  // Tests replace the model call; production uses the CLIs and the proxy.
  complete?: Complete;
  // Tests replace these too. `null` means the source does not exist on this server.
  mail?: MailAccess | null;
  sheets?: SheetsAccess | null;
  reason?: ReasonClient | null;
};

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerAgentRoutes(app: FastifyInstance, db: CairnDatabase, gateway: LlmGateway | undefined, opts: AgentRouteOptions = {}): void {
  const complete = opts.complete ?? createComplete(gateway);
  // Tests that only replace the model must not reach the real mailbox or the real network.
  const google = opts.complete ? undefined : createGoogleAccess();
  const mail = opts.mail !== undefined ? opts.mail ?? undefined : google?.mail;
  const sheets = opts.sheets !== undefined ? opts.sheets ?? undefined : google?.sheets;
  const listSheets = (): AgentSheet[] => db.select().from(agentSheets).orderBy(asc(agentSheets.id)).all()
    .map((r) => ({ id: r.id, name: r.name, url: `https://docs.google.com/spreadsheets/d/${r.spreadsheetId}` }));
  const reason = opts.reason !== undefined ? opts.reason ?? undefined : opts.complete ? undefined : createReasonClient();

  // The panel belongs to the person at the screen. Remote connectors must not drive it or read its conversations.
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/agent") && isRemoteAudience(req)) {
      return reply.code(403).send({ ok: false, error: { code: "FORBIDDEN", message: "not available to remote connectors" } });
    }
  });

  app.get("/api/agent/providers", async (_req, reply) => {
    return reply.send({ ok: true, data: { providers: listProviders(gateway) } });
  });

  app.get("/api/agent/sources", async (_req, reply) => {
    const data: AgentSources = {
      mail: { configured: mail?.configured() ?? false, connected: mail?.connected() ?? false },
      sheets: { connected: sheets?.connected() ?? false, list: listSheets() },
      reason: { available: reason?.available() ?? false, session: reason?.session ?? "", unread: reason?.available() ? unreadCount(db) : 0 },
      candidates: listEventCandidates(db).length
    };
    return reply.send({ ok: true, data });
  });

  // Connecting mail: the panel opens this address, the user approves at Google, and pastes back
  // the address the browser was sent to.
  app.get("/api/agent/mail/auth-url", async (_req, reply) => {
    if (!mail?.configured()) return reply.code(503).send({ ok: false, error: { code: "MAIL_NOT_CONFIGURED", message: "이 서버에 구글 OAuth 클라이언트가 설정되지 않았습니다" } });
    return reply.send({ ok: true, data: { url: mail.authUrl() } });
  });

  app.post("/api/agent/mail/connect", async (req, reply) => {
    const parsed = AgentMailConnectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    if (!mail?.configured()) return reply.code(503).send({ ok: false, error: { code: "MAIL_NOT_CONFIGURED", message: "이 서버에 구글 OAuth 클라이언트가 설정되지 않았습니다" } });
    try {
      await mail.connect(parsed.data.code);
    } catch (e) {
      return reply.code(400).send({ ok: false, error: { code: "MAIL_CONNECT_FAILED", message: e instanceof Error ? e.message : "메일을 연결하지 못했습니다" } });
    }
    return reply.send({ ok: true, data: { connected: true } });
  });

  app.delete("/api/agent/mail", async (_req, reply) => {
    mail?.disconnect();
    return reply.send({ ok: true, data: { connected: false } });
  });

  // Which spreadsheets the agent may read: only the ones registered here.
  app.post("/api/agent/sheets", async (req, reply) => {
    const parsed = AgentSheetAddRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    const spreadsheetId = spreadsheetIdOf(parsed.data.url);
    if (!spreadsheetId) return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "구글 스프레드시트 주소가 아닙니다" } });
    if (!sheets?.connected()) return reply.code(409).send({ ok: false, error: { code: "SHEETS_NOT_CONNECTED", message: "Google 을 먼저 연결하세요" } });
    let title: string;
    try {
      title = (await sheets.info(spreadsheetId)).title;
    } catch (e) {
      return reply.code(400).send({ ok: false, error: { code: "SHEET_UNREADABLE", message: e instanceof Error ? e.message : "시트를 열 수 없습니다" } });
    }
    db.insert(agentSheets).values({ spreadsheetId, name: parsed.data.name || title || "시트", addedAt: new Date().toISOString() })
      .onConflictDoNothing({ target: agentSheets.spreadsheetId }).run();
    return reply.send({ ok: true, data: { sheets: listSheets() } });
  });

  app.delete("/api/agent/sheets/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (id) db.delete(agentSheets).where(eq(agentSheets.id, id)).run();
    return reply.send({ ok: true, data: { sheets: listSheets() } });
  });

  app.get("/api/agent/conversations", async (_req, reply) => {
    return reply.send({ ok: true, data: { conversations: listConversations(db) } });
  });

  app.get("/api/agent/conversations/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    const data = id ? getConversation(db, id) : null;
    if (!data) return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "대화를 찾을 수 없습니다" } });
    return reply.send({ ok: true, data });
  });

  app.delete("/api/agent/conversations/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id || !deleteConversation(db, id)) return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "대화를 찾을 수 없습니다" } });
    return reply.send({ ok: true, data: { deleted: id } });
  });

  app.post("/api/agent/chat", async (req, reply) => {
    const parsed = AgentChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const provider = listProviders(gateway).find((p) => p.id === parsed.data.provider);
    const via = `${provider?.label ?? parsed.data.provider}${parsed.data.model ? ` · ${parsed.data.model}` : ""}`;

    // A browser that asks for an event stream gets progress while the answer is being made.
    if ((req.headers.accept ?? "").includes("text/event-stream")) {
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
      const send = (event: AgentStreamEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      try {
        const data = await runTurn({ req: parsed.data, db, app, complete, via, mail, sheets, reason, onEvent: send });
        send({ type: "done", data });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "프로바이더 호출에 실패했습니다" });
      }
      reply.raw.end();
      return;
    }

    try {
      const data = await runTurn({ req: parsed.data, db, app, complete, via, mail, sheets, reason });
      return reply.send({ ok: true, data });
    } catch (e) {
      // The provider could not be reached or timed out.
      return reply.code(502).send({
        ok: false,
        error: { code: "PROVIDER_ERROR", message: e instanceof Error ? e.message : "프로바이더 호출에 실패했습니다" },
        ...(e instanceof AgentTurnError ? { conversationId: e.conversationId } : {})
      });
    }
  });

  app.post("/api/agent/confirm", async (req, reply) => {
    const parsed = AgentConfirmRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const result = await confirmPending(db, parsed.data.id, parsed.data.approve);
    if (!result) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "승인할 항목이 없거나 시간이 지났습니다" } });
    }
    return reply.send({ ok: true, data: result });
  });
}
