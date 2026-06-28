import type { FastifyInstance } from "fastify";
import { UpsertPinnedTransitRequestSchema } from "@cairn/shared";
import { upsertPinnedTransitFact } from "../services/pinned-transit-facts.js";
import type { CairnDatabase } from "../db/index.js";

// Pinned transit facts route (cycle-78). Thin handler: validate the body
// (event ids + duration/note ONLY — no coordinates), call the service, map its
// typed result to a stable HTTP shape. Registered only when a DB exists.
export function registerTransitFactsRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.put("/api/transit-facts/pair", async (req, reply) => {
    const parsed = UpsertPinnedTransitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }

    let result;
    try {
      result = upsertPinnedTransitFact(db, parsed.data);
    } catch {
      return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: "Could not save the pinned transit fact" } });
    }

    if (result.ok) {
      return reply.send({ ok: true, data: result.data });
    }
    if (result.kind === "not_found") {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    }
    if (result.kind === "location_missing") {
      return reply.code(409).send({ ok: false, error: { code: "LOCATION_MISSING", message: "Event has no location to pin" } });
    }
    // location_unresolved: no resolved geocode for an endpoint — no provider call is made.
    return reply.code(409).send({ ok: false, error: { code: "LOCATION_UNRESOLVED", message: "Event location is not geocoded yet" } });
  });
}
