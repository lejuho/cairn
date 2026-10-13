import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CreateObservationRequestSchema,
  InboxAnswerRequestSchema,
  InboxQuerySchema,
  ThreadWorkspaceRequestSchema
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { insertObservation, listRecentObservations } from "../services/observations.js";
import { answerInboxItem, buildContextNow, listInbox, setThreadWorkspace } from "../services/inbox.js";

function validationError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message } });
}

// 폰 알림은 tailnet 을 거쳐 들어오므로 토큰을 요구한다. 토큰 미설정이면 loopback 만 허용.
function ingestAllowed(req: FastifyRequest, token: string | undefined): boolean {
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (token) {
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
}

export function registerInboxRoutes(
  app: FastifyInstance,
  db: CairnDatabase,
  opts: { ingestToken?: string | undefined } = {}
): void {
  // 폰 자동화 앱(MacroDroid 등)은 알림 본문을 JSON 이스케이프하지 못하므로 form 인코딩도 받는다.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
  }

  app.get("/api/inbox", async (req, reply) => {
    const parsed = InboxQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: listInbox(db, parsed.data) });
  });

  app.post("/api/inbox/:id/answer", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) return validationError(reply, "id must be a positive integer");
    const parsed = InboxAnswerRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const result = answerInboxItem(db, id, parsed.data);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "CONFLICT" ? 409 : 400;
      return reply.code(status).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: { id: result.item.id, status: result.item.status, effect: result.effect } });
  });

  app.get("/api/context/now", async (req, reply) => {
    const parsed = InboxQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: buildContextNow(db, parsed.data) });
  });

  app.post("/api/thread-workspaces", async (req, reply) => {
    const parsed = ThreadWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    if (!setThreadWorkspace(db, parsed.data.threadId, parsed.data.path)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: `thread ${parsed.data.threadId} not found` } });
    }
    return reply.send({ ok: true, data: parsed.data });
  });

  app.post("/api/observations", async (req, reply) => {
    if (!ingestAllowed(req, opts.ingestToken)) {
      return reply.code(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "ingest token required" } });
    }
    const parsed = CreateObservationRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: insertObservation(db, parsed.data) });
  });

  app.get("/api/observations", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    return reply.send({ ok: true, data: { observations: listRecentObservations(db, q.source, limit) } });
  });
}
