import type { FastifyInstance } from "fastify";
import { ScheduleEventRequestSchema, SlotCandidatesQuerySchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { findEventById, findEventsInRange, scheduleEvent } from "../repositories/events.js";
import { generateSlotCandidates } from "../services/slotCandidates.js";

function isUnscheduledCairnEvent(event: {
  source: string | null;
  selfImposed: number | null;
  start: string | null;
  end: string | null;
  status: string | null;
}): boolean {
  return (
    event.source === "cairn" &&
    event.selfImposed === 1 &&
    event.start === null &&
    event.end === null &&
    event.status === "planned"
  );
}

export function registerSlotRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/events/:id/slot-candidates", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }

    const q = SlotCandidatesQuerySchema.safeParse(req.query);
    if (!q.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: q.error.message } });
    }

    const event = findEventById(db, id);
    if (!event) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    }
    if (!isUnscheduledCairnEvent(event)) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Event is not an unscheduled Cairn planned event" } });
    }

    const candidates = generateSlotCandidates(db, event, q.data.now, q.data.date, q.data.days);
    return reply.send({ ok: true, data: { event, candidates } });
  });

  app.patch("/api/events/:id/schedule", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }

    const body = ScheduleEventRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: body.error.message } });
    }

    const { start, end } = body.data;

    const event = findEventById(db, id);
    if (!event) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    }
    if (!isUnscheduledCairnEvent(event)) {
      return reply.code(409).send({ ok: false, error: { code: "CONFLICT", message: "Event is already scheduled or not eligible" } });
    }

    const overlapping = findEventsInRange(db, start, end);
    if (overlapping.some((e) => e.id !== id)) {
      return reply.code(409).send({ ok: false, error: { code: "CONFLICT", message: "Time slot conflicts with an existing event" } });
    }

    // scheduleEvent uses WHERE start IS NULL — returns null if already scheduled by concurrent request
    const updated = scheduleEvent(db, id, start, end);
    if (!updated) {
      return reply.code(409).send({ ok: false, error: { code: "CONFLICT", message: "Event was already scheduled" } });
    }

    return reply.send({ ok: true, data: { event: updated } });
  });
}
