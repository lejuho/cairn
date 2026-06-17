import type { FastifyInstance } from "fastify";
import { CreateEventRequestSchema } from "@cairn/shared";
import { createEventWithPeople } from "../repositories/events.js";
import { findPeopleByIds } from "../repositories/people.js";
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
      const deduped = [...new Set(parsed.data.personIds ?? [])];
      if (deduped.length > 0) {
        const found = findPeopleByIds(db, deduped);
        if (found.length !== deduped.length) {
          return reply.code(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "one or more person ids not found" }
          });
        }
      }
      const event = createEventWithPeople(db, parsed.data, deduped);
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
