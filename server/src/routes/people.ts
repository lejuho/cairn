import type { FastifyInstance } from "fastify";
import { CreatePersonRequestSchema, PatchPersonRequestSchema, PersonDetailQuerySchema, PersonDirectoryQuerySchema, ReplaceEventPeopleRequestSchema, ReplaceHardConstraintsRequestSchema, UpdatePersonProfileRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { listNotes } from "../services/notes.js";
import { isRemoteAudience } from "../utils/audience.js";
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
  replaceHardConstraints,
  listPersonGroups,
  deletePerson,
  personUsage,
  updatePersonBasics,
  updatePersonProfile
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
    // Notes kept on this person ride along, so the page needs no second request.
    const notes = listNotes(db, { targetType: "person", targetId: id, limit: 100 }, { remoteOnly: isRemoteAudience(req) }).notes;
    return reply.send({ ok: true, data: { person: personDir, recentMeetings, notes } });
  });

  app.put("/api/people/:id/profile", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = UpdatePersonProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    if (!findPersonById(db, id)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } });
    }
    const result = updatePersonProfile(db, id, parsed.data);
    if (result === null) {
      // null means validation failure (contradiction or half-empty) — the existence guard above
      // already returned 404 for unknown persons, so this branch is validation-only.
      const prefWd = parsed.data.preferredWeekdays;
      const unavWd = parsed.data.unavailableWeekdays;
      const hasOverlap = prefWd.some((d) => unavWd.includes(d));
      const msg = hasOverlap
        ? "preferredWeekdays and unavailableWeekdays must not overlap"
        : "preferredWeekdays and preferredPeriods must both be non-empty or both empty";
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: msg } });
    }
    return reply.send({ ok: true, data: { person: result } });
  });

  // Group names in use, for the pickers and the list filter.
  app.get("/api/people/groups", async (_req, reply) => {
    return reply.send({ ok: true, data: { groups: listPersonGroups(db) } });
  });

  // Name, description, channel, groups. Preferences and constraints have their own routes.
  app.patch("/api/people/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PatchPersonRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const person = updatePersonBasics(db, id, parsed.data);
    if (!person) return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Person not found" } });
    return reply.send({ ok: true, data: { person } });
  });

  // Deleting someone who is still on events or notes needs `?force=1`: the first call answers
  // with what they are attached to, so the screen can ask before unhooking them.
  app.delete("/api/people/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    if (isRemoteAudience(req)) return reply.code(403).send({ ok: false, error: { code: "FORBIDDEN", message: "not available to remote connectors" } });
    if (!findPersonById(db, id)) return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Person not found" } });
    const usage = personUsage(db, id);
    const force = (req.query as Record<string, string>).force !== undefined;
    if (!force && usage.events + usage.notes + usage.resources > 0) {
      return reply.code(409).send({ ok: false, error: { code: "IN_USE", message: "아직 연결된 것이 있습니다" }, data: { usage } });
    }
    deletePerson(db, id);
    return reply.send({ ok: true, data: { deleted: id, usage } });
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
    const person = replaceHardConstraints(db, id, parsed.data.unavailableWeekdays);
    if (person === null) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } });
    }
    if (person === "conflict") {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "unavailableWeekdays overlaps with existing preferredWeekdays" } });
    }
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
