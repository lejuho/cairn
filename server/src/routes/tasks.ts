import type { FastifyInstance } from "fastify";
import { CreateTaskRequestSchema, PatchTaskStatusRequestSchema } from "@cairn/shared";
import { createTask, updateTaskStatus } from "../repositories/tasks.js";
import type { CairnDatabase } from "../db/index.js";

export function registerTaskRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/tasks", async (req, reply) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    try {
      const task = createTask(db, parsed.data);
      return reply.code(201).send({ ok: true, data: task });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });

  app.patch("/api/tasks/:id/status", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const parsed = PatchTaskStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const task = updateTaskStatus(db, id, parsed.data.status);
    if (!task) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `task ${id} not found` }
      });
    }

    return reply.send({ ok: true, data: task });
  });
}
