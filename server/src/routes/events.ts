import type { FastifyInstance } from "fastify";
import { CreateEventPreparationRequestSchema, CreateEventRequestSchema, DismissSchedulePromptRequestSchema, PatchEventStatusRequestSchema, PatchThreadEventNodeRequestSchema } from "@cairn/shared";
import { createEventWithPeople, dismissSchedulePromptForDate, findEventById, findNearestPriorThreadEvent, updateEventStatus, updateEventThreadNode } from "../repositories/events.js";
import { findAnnotationsByEvent } from "../repositories/annotations.js";
import { findEventWithPeople, findPeopleByIds } from "../repositories/people.js";
import { findThreadById } from "../repositories/threads.js";
import { addEventPreparation, findPreparationLinkData } from "../repositories/resources.js";
import { eventExists } from "../repositories/resources.js";
import { buildScheduleBrief, pickNewestAnnotation } from "../services/scheduleBrief.js";
import { buildPreparations } from "../services/preparationBrief.js";
import { buildPreparationSuggestions } from "../services/preparationSuggestions.js";
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

    // Schedule Brief A (read-only): nearest prior same-thread event + its newest
    // annotation. Only when this event has a thread and a start to anchor on.
    const previousEvent =
      result.event.threadId != null && result.event.start != null
        ? findNearestPriorThreadEvent(db, result.event.threadId, result.event.start, result.event.id)
        : null;
    const previousAnnotation = previousEvent
      ? pickNewestAnnotation(findAnnotationsByEvent(db, previousEvent.id))
      : null;

    // Preparation Brief A (cycle-45): resources linked to the event, its thread,
    // or the nearest prior same-thread event. Read-only.
    const preparations = buildPreparations(
      findPreparationLinkData(db, result.event.id, result.event.threadId ?? null, previousEvent?.id ?? null)
    );
    // Preparation Suggestions A (cycle-47): deterministic keyword suggestions
    // from already-loaded event/thread, suppressing items already prepared.
    const preparationSuggestions = buildPreparationSuggestions(result.event, thread, preparations);
    const scheduleBrief = buildScheduleBrief(result.event, thread, previousEvent, previousAnnotation, result.people, preparations, preparationSuggestions);

    return reply.send({ ok: true, data: { event: result.event, people: result.people, annotations, thread: compactThread, scheduleBrief } });
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

  // Thread node inline edit (cycle-50 FR-THR-06). Edits only title/type/
  // location/mode. GCal-imported events are read-only here (409). start/end/
  // status/threadId/source are not editable.
  app.patch("/api/events/:id/thread-node", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PatchThreadEventNodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const event = findEventById(db, id);
    if (!event) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    if (event.source === "gcal") {
      return reply.code(409).send({ ok: false, error: { code: "EXTERNAL_EVENT_READ_ONLY", message: "external calendar events are read-only" } });
    }
    const updated = updateEventThreadNode(db, id, parsed.data)!;
    return reply.send({ ok: true, data: { event: updated } });
  });

  // Dismiss a schedule prompt for one Today date (cycle-61 FR-SLOT-06B/
  // FR-TODAY-05). Hides the unscheduled-event card from /api/today for the
  // given date only. 404 when the event is unknown; 409 when it exists but is
  // no longer an eligible schedule-prompt source (scheduled/external/cancelled/
  // non-self-imposed). Idempotent.
  app.patch("/api/events/:id/schedule-prompt/dismiss", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = DismissSchedulePromptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    if (!findEventById(db, id)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    const dismissed = dismissSchedulePromptForDate(db, id, parsed.data.dismissedOn, new Date().toISOString());
    if (!dismissed) {
      return reply.code(409).send({ ok: false, error: { code: "SCHEDULE_PROMPT_NOT_ELIGIBLE", message: "event is not an eligible schedule prompt" } });
    }
    return reply.send({ ok: true, data: { eventId: id, dismissedOn: parsed.data.dismissedOn } });
  });

  // Manual one-line preparation entry (cycle-46 FR-BRF-04). Find-or-create an
  // item resource and idempotently link it to the event in one transaction.
  app.post("/api/events/:id/preparations", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = CreateEventPreparationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    if (!eventExists(db, id)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    try {
      const result = addEventPreparation(db, id, parsed.data.name);
      // 200 when the exact event link already existed; 201 when newly created.
      return reply.code(result.reusedLink ? 200 : 201).send({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: msg } });
    }
  });
}
