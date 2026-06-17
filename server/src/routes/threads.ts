import type { FastifyInstance } from "fastify";
import { CreateThreadRequestSchema } from "@cairn/shared";
import { createThread, getThreadDetail, listThreads } from "../services/threads.js";
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
}
