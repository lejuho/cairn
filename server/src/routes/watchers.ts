import type { FastifyInstance } from "fastify";
import { CreateWatcherRequestSchema, PatchWatcherSnoozeRequestSchema } from "@cairn/shared";
import { createWatcher, snoozeWatcher } from "../repositories/watchers.js";
import type { CairnDatabase } from "../db/index.js";

export function registerWatcherRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/watchers", async (req, reply) => {
    const parsed = CreateWatcherRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    try {
      const watcher = createWatcher(db, parsed.data);
      return reply.code(201).send({ ok: true, data: watcher });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });

  app.patch("/api/watchers/:id/snooze", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const parsed = PatchWatcherSnoozeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const watcher = snoozeWatcher(db, id, parsed.data.snoozedUntil);
    if (!watcher) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `watcher ${id} not found` }
      });
    }

    return reply.send({ ok: true, data: watcher });
  });
}
