import type { FastifyInstance } from "fastify";
import { CreateEventRequestSchema, PatchEventStatusRequestSchema } from "@cairn/shared";
import { createEventWithPeople, findEventById, updateEventStatus } from "../repositories/events.js";
import { findAnnotationsByEvent } from "../repositories/annotations.js";
import { findEventWithPeople, findPeopleByIds } from "../repositories/people.js";
import { findThreadById } from "../repositories/threads.js";
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

  app.get("/api/events/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const result = findEventWithPeople(db, id);
    if (!result) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    const annotations = findAnnotationsByEvent(db, id);
    const thread = result.event.threadId
      ? (findThreadById(db, result.event.threadId) ?? null)
      : null;
    const compactThread = thread ? { id: thread.id, name: thread.name } : null;
    return reply.send({ ok: true, data: { event: result.event, people: result.people, annotations, thread: compactThread } });
  });

  app.patch("/api/events/:id/status", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PatchEventStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const event = findEventById(db, id);
    if (!event) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    updateEventStatus(db, id, parsed.data.status);
    const updated = findEventById(db, id)!;
    return reply.send({ ok: true, data: { event: updated } });
  });
}
