import type { FastifyInstance } from "fastify";
import { CreateThreadLinkRequestSchema, CreateThreadRequestSchema, PatchThreadResumeRequestSchema, ThreadResumeExportQuerySchema } from "@cairn/shared";
import {
  createThread,
  createThreadLink,
  deleteThreadLink,
  getThreadDetail,
  listThreads
} from "../services/threads.js";
import { confirmThreadNodeLink } from "../repositories/links.js";
import { findThreadById, updateThreadResume } from "../repositories/threads.js";
import { exportThreadResume } from "../services/threadResumeExport.js";
import type { CairnDatabase } from "../db/index.js";

// Strict positive-integer path param: rejects "1abc"/"1.5"/"" that parseInt
// would silently coerce to a valid id. Returns null on any non-integer input.
function parsePositiveIntParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function registerThreadRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/threads", async (req, reply) => {
    const parsed = CreateThreadRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const thread = createThread(db, parsed.data);
    return reply.code(201).send({ ok: true, data: thread });
  });

  app.get("/api/threads", async (_req, reply) => {
    const summaries = listThreads(db);
    return reply.send({ ok: true, data: summaries });
  });

  app.get("/api/threads/:id", async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }
    const detail = getThreadDetail(db, id);
    if (!detail) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Thread not found" }
      });
    }
    return reply.send({ ok: true, data: detail });
  });

  app.post("/api/threads/:id/links", async (req, reply) => {
    const fromThreadId = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(fromThreadId) || fromThreadId <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }
    const parsed = CreateThreadLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const result = createThreadLink(db, fromThreadId, parsed.data);
    if (result.status === "error") {
      const httpCode =
        result.code === "NOT_FOUND" ? 404
        : (result.code === "CONTAINS_CYCLE" || result.code === "CONTAINS_PARENT_CONFLICT") ? 409
        : 400;
      return reply.code(httpCode).send({
        ok: false,
        error: { code: result.code, message: result.message }
      });
    }
    const httpStatus = result.status === "created" ? 201 : 200;
    return reply.code(httpStatus).send({ ok: true, data: { link: result.link } });
  });

  app.delete("/api/threads/:id/links/:linkId", async (req, reply) => {
    const params = req.params as { id: string; linkId: string };
    const fromThreadId = parseInt(params.id, 10);
    const linkId = parseInt(params.linkId, 10);
    if (!Number.isFinite(fromThreadId) || fromThreadId <= 0 || !Number.isFinite(linkId) || linkId <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id and linkId must be positive integers" }
      });
    }

    const result = deleteThreadLink(db, fromThreadId, linkId);
    if (result.status === "error") {
      const httpCode = result.code === "NOT_FOUND" ? 404 : 400;
      return reply.code(httpCode).send({
        ok: false,
        error: { code: result.code, message: result.message }
      });
    }
    return reply.send({ ok: true });
  });

  // Explicit firmness promotion (cycle-50 FR-THR-05). Promotes a same-thread
  // event/task node link to hard/authored. Idempotent for already-confirmed
  // links. 404 when the link is unknown, cross-thread, or has a missing endpoint.
  app.patch("/api/threads/:id/node-links/:linkId/confirm", async (req, reply) => {
    const params = req.params as { id: string; linkId: string };
    const threadId = parseInt(params.id, 10);
    const linkId = parseInt(params.linkId, 10);
    if (!Number.isFinite(threadId) || threadId <= 0 || !Number.isFinite(linkId) || linkId <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id and linkId must be positive integers" }
      });
    }
    const result = confirmThreadNodeLink(db, threadId, linkId);
    if (!result) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "node link not found in this thread" }
      });
    }
    return reply.send({ ok: true, data: result });
  });

  // Resume / CV STAR save+edit (cycle-56 FR-CV-01/03). Deterministic (no
  // gateway). Mutates only the target thread's resume columns; completed-only.
  app.patch("/api/threads/:id/resume", async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PatchThreadResumeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const thread = findThreadById(db, id);
    if (!thread) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "thread not found" } });
    }
    if (thread.status !== "done") {
      return reply.code(409).send({ ok: false, error: { code: "THREAD_NOT_DONE", message: "thread is not complete" } });
    }
    try {
      const data = updateThreadResume(db, id, parsed.data);
      return reply.send({ ok: true, data });
    } catch (err) {
      return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) } });
    }
  });

  // Resume export A (cycle-57 FR-CV-02). Deterministic, read-only export of the
  // saved resume fields as JSON or Markdown. No DB write, no LLM gateway.
  app.get("/api/threads/:id/resume-export", async (req, reply) => {
    const id = parsePositiveIntParam((req.params as { id: string }).id);
    if (id === null) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const query = ThreadResumeExportQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "format must be json or markdown" } });
    }
    const result = exportThreadResume(db, id, query.data.format);
    if (result.status === "ok") return reply.send({ ok: true, data: result.data });
    if (result.status === "not_found") {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "thread not found" } });
    }
    if (result.status === "not_done") {
      return reply.code(409).send({ ok: false, error: { code: "THREAD_NOT_DONE", message: "thread is not complete" } });
    }
    if (result.status === "not_marked") {
      return reply.code(409).send({ ok: false, error: { code: "RESUME_NOT_MARKED", message: "thread is not marked resume-relevant" } });
    }
    return reply.code(409).send({ ok: false, error: { code: "RESUME_EMPTY", message: "no saved resume content to export" } });
  });
}
