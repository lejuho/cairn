import type { FastifyInstance } from "fastify";
import { CreatePersonRequestSchema, PersonDetailQuerySchema, PersonDirectoryQuerySchema, ReplaceEventPeopleRequestSchema, ReplaceHardConstraintsRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { findEventById } from "../repositories/events.js";
import {
  createPerson,
  findAllPeople,
  findEventWithPeople,
  findPeopleByIds,
  findPeopleDirectoryRows,
  findPersonById,
  findRecentMeetings,
  replaceEventPeople,
  replaceHardConstraints
} from "../repositories/people.js";

export function registerPeopleRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/people/directory", async (req, reply) => {
    const parsed = PersonDirectoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const rows = findPeopleDirectoryRows(db, parsed.data.now);
    return reply.send({ ok: true, data: { people: rows } });
  });

  app.get("/api/people/:id/detail", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PersonDetailQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    // Use directory rows for consistent stat computation (same qualifying rule as directory)
    const allDir = findPeopleDirectoryRows(db, parsed.data.now);
    const personDir = allDir.find((p) => p.id === id);
    if (!personDir) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } });
    }
    const recentMeetings = findRecentMeetings(db, id, parsed.data.now);
    return reply.send({ ok: true, data: { person: personDir, recentMeetings } });
  });

  app.get("/api/people", async (_req, reply) => {
    const rows = findAllPeople(db);
    return reply.send({ ok: true, data: rows });
  });

  app.post("/api/people", async (req, reply) => {
    try {
      const parsed = CreatePersonRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: parsed.error.message }
        });
      }
      if (!parsed.data.displayName.trim()) {
        return reply.code(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "displayName must be non-empty" }
        });
      }
      const person = createPerson(db, parsed.data);
      return reply.code(201).send({ ok: true, data: { person } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: { code: "DB_ERROR", message: msg } });
    }
  });

  app.get("/api/events/:id/people", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const result = findEventWithPeople(db, id);
    if (!result) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "event not found" } });
    }
    return reply.send({ ok: true, data: result });
  });

  app.put("/api/people/:id/hard-constraints", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = ReplaceHardConstraintsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const existing = findPersonById(db, id);
    if (!existing) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } });
    }
    const person = replaceHardConstraints(db, id, parsed.data.unavailableWeekdays);
    return reply.send({ ok: true, data: { person } });
  });

  app.put("/api/events/:id/people", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = ReplaceEventPeopleRequestSchema.safeParse(req.body);
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
    const deduped = [...new Set(parsed.data.personIds)];
    if (deduped.length > 0) {
      const found = findPeopleByIds(db, deduped);
      if (found.length !== deduped.length) {
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "one or more person ids not found" }
        });
      }
    }
    const attached = replaceEventPeople(db, id, deduped);
    return reply.send({ ok: true, data: { event, people: attached } });
  });
}
