import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import {
  CandidateFeasibilityRequestSchema,
  CreateObservationRequestSchema,
  PinRouteRequestSchema,
  ProposeEventRequestSchema,
  InboxAnswerRequestSchema,
  InboxQuerySchema,
  ThreadWorkspaceRequestSchema
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway } from "../maps/gateway.js";
import { normalizeLocation } from "../maps/normalize.js";
import { upsertPinned } from "../repositories/pinned-transit-facts.js";
import { checkCandidateFeasibility } from "../services/candidate-feasibility.js";
import { geocodeText } from "../services/geocoding.js";
import { insertObservation, listRecentObservations } from "../services/observations.js";
import { answerInboxItem, buildContextNow, listInbox, setThreadWorkspace, upsertInboxItem } from "../services/inbox.js";
import { inboxItems } from "../db/schema.js";
import { eq } from "drizzle-orm";

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
  opts: { ingestToken?: string | undefined; mapGateway?: MapGateway | undefined } = {}
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

  app.post("/api/feasibility/candidate", async (req, reply) => {
    const parsed = CandidateFeasibilityRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: await checkCandidateFeasibility(db, opts.mapGateway, parsed.data) });
  });

  app.post("/api/inbox/propose-event", async (req, reply) => {
    const parsed = ProposeEventRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const p = parsed.data;
    const feasibility = await checkCandidateFeasibility(db, opts.mapGateway, p);
    // 같은 행사를 여러 에이전트가 찾아도 한 번만 묻는다 — URL 이 있으면 URL 기준.
    const identity = p.url ?? `${p.title}|${p.start}`;
    const dedupeKey = `proposal:${createHash("sha1").update(identity).digest("hex").slice(0, 16)}`;
    const when = new Intl.DateTimeFormat("ko-KR", { timeZone: process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(p.start));
    const where = p.online || !p.location ? "온라인" : p.location;
    const existed = db.select().from(inboxItems).where(eq(inboxItems.dedupeKey, dedupeKey)).get();
    upsertInboxItem(db, {
      kind: "event_candidate",
      dedupeKey,
      prompt: `${when} '${p.title}' (${where}) — 참여 판정: ${feasibility.verdictKo}. 일정에 넣을까요?`,
      payload: JSON.stringify({
        title: p.title, start: p.start, end: p.end ?? null, location: p.online ? null : (p.location ?? null), online: p.online ?? !p.location,
        url: p.url ?? null, origin: p.origin ?? null, note: p.note ?? null,
        feasibility: { verdict: feasibility.verdict, reasons: feasibility.reasons, assumptions: feasibility.assumptions }
      }),
      evidence: JSON.stringify([{ proposedBy: p.proposedBy ?? null, origin: p.origin ?? null, url: p.url ?? null }]),
      priority: feasibility.verdict === "hard" ? 30 : 55,
      expiresAt: p.start
    });
    const item = db.select().from(inboxItems).where(eq(inboxItems.dedupeKey, dedupeKey)).get()!;
    return reply.send({ ok: true, data: { inboxId: item.id, alreadyKnown: !!existed, status: item.status, feasibility } });
  });

  app.post("/api/routes/pin", async (req, reply) => {
    const parsed = PinRouteRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    if (!opts.mapGateway) {
      return reply.code(503).send({ ok: false, error: { code: "MAP_DISABLED", message: "map provider not configured" } });
    }
    const { from, to, minutes, note } = parsed.data;
    const [a, b] = await Promise.all([geocodeText(db, opts.mapGateway, from), geocodeText(db, opts.mapGateway, to)]);
    if (!a || !b) {
      return reply.code(422).send({ ok: false, error: { code: "GEOCODE_FAILED", message: `could not resolve ${!a ? from : to}` } });
    }
    const row = upsertPinned(db, {
      originNormalized: normalizeLocation(from), destNormalized: normalizeLocation(to),
      originLabel: from, destLabel: to, originLat: a.lat, originLng: a.lng, destLat: b.lat, destLng: b.lng,
      mode: "public_transit", durationMinutes: minutes, note: note ?? null, source: "pinned_user"
    });
    return reply.send({ ok: true, data: { id: row.id, from, to, minutes: row.durationMinutes } });
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
