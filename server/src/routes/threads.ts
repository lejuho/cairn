import type { FastifyInstance } from "fastify";
import { CreateThreadLinkRequestSchema, CreateThreadRequestSchema } from "@cairn/shared";
import {
  createThread,
  createThreadLink,
  deleteThreadLink,
  getThreadDetail,
  listThreads
} from "../services/threads.js";
import { confirmThreadNodeLink } from "../repositories/links.js";
import type { CairnDatabase } from "../db/index.js";

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
}
