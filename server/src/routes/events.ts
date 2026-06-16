import type { FastifyInstance } from "fastify";
import { CreateEventRequestSchema } from "@cairn/shared";
import { createEvent } from "../repositories/events.js";
import type { CairnDatabase } from "../db/index.js";

export function registerEventRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/events", async (req, reply) => {
    const parsed = CreateEventRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { start, end } = parsed.data;
    if (end <= start) {
      return reply.code(400).send({
        ok: false,
        error: { code: "INVALID_TIME_RANGE", message: "end must be after start" }
      });
    }

    try {
      const event = createEvent(db, parsed.data);
      return reply.code(201).send({ ok: true, data: event });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });
}
