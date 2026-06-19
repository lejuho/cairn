import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ConflictDecisionQuerySchema, ResolveConflictRequestSchema } from "@cairn/shared";
import { findEventsWithCostsForDate } from "../repositories/events.js";
import { buildConflictDecisions, eventsOverlap, isResolvable } from "../services/decision.js";
import type { CairnDatabase } from "../db/index.js";
import { annotations, events } from "../db/schema.js";

export function registerDecisionRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/decisions/conflicts", async (req, reply) => {
    const parsed = ConflictDecisionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { date, now } = parsed.data;
    const dayEvents = findEventsWithCostsForDate(db, date);
    const conflicts = buildConflictDecisions(now, dayEvents);

    return reply.send({ ok: true, data: { conflicts } });
  });

  app.post("/api/decisions/conflicts/resolve", async (req, reply) => {
    const parsed = ResolveConflictRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { keepEventId, changeEventId, outcome, note, now: bodyNow } = parsed.data;
    const nowMs = Date.parse(bodyNow ?? new Date().toISOString());

    // Single transaction: recheck overlap + update status + insert annotation atomically
    const result = db.transaction((tx) => {
      const keepEvent = tx.select().from(events).where(eq(events.id, keepEventId)).get();
      const changeEvent = tx.select().from(events).where(eq(events.id, changeEventId)).get();

      if (!keepEvent || !changeEvent) return { status: 404 as const };
      const activeStatuses = ["planned", "confirmed"] as const;
      if (!activeStatuses.includes(keepEvent.status as "planned" | "confirmed") ||
          !activeStatuses.includes(changeEvent.status as "planned" | "confirmed")) {
        return { status: 409 as const, code: "CONFLICT_STALE" as const };
      }
      if (!eventsOverlap(keepEvent, changeEvent)) {
        return { status: 409 as const, code: "CONFLICT_STALE" as const };
      }
      // Actionability gate: at least one event must start within [now, now+6h]
      const keepStart = keepEvent.start ? Date.parse(keepEvent.start) : NaN;
      const changeStart = changeEvent.start ? Date.parse(changeEvent.start) : NaN;
      if (!isResolvable(nowMs, keepStart) && !isResolvable(nowMs, changeStart)) {
        return { status: 409 as const, code: "CONFLICT_NOT_ACTIONABLE" as const };
      }

      const [updated] = tx
        .update(events)
        .set({ status: outcome })
        .where(eq(events.id, changeEventId))
        .returning()
        .all();

      const reasonText = note ?? "conflict_resolution";
      const [annotation] = tx
        .insert(annotations)
        .values({
          eventId: changeEventId,
          outcome,
          reasonTags: JSON.stringify(["conflict_resolution"]),
          reasonText,
          energyAtTime: null
        })
        .returning()
        .all();

      return { status: 200 as const, changedEvent: updated!, annotation: annotation! };
    });

    if (result.status === 404) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND" } });
    }
    if (result.status === 409) {
      return reply.code(409).send({ ok: false, error: { code: result.code } });
    }

    return reply.send({
      ok: true,
      data: { changedEvent: result.changedEvent, annotation: result.annotation }
    });
  });
}
