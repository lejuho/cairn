import type { FastifyInstance } from "fastify";
import { CreateEventRequestSchema } from "@cairn/shared";
import { createEvent } from "../repositories/events.js";
import { findPeopleByIds, replaceEventPeople } from "../repositories/people.js";
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
      const personIds = parsed.data.personIds ?? [];
      if (personIds.length > 0) {
        const deduped = [...new Set(personIds)];
        const found = findPeopleByIds(db, deduped);
        if (found.length !== deduped.length) {
          return reply.code(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "one or more person ids not found" }
          });
        }
      }
      const event = createEvent(db, parsed.data);
      if (personIds.length > 0) {
        replaceEventPeople(db, event.id, [...new Set(personIds)]);
      }
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
