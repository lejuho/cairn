import type { FastifyInstance } from "fastify";
import { FeasibilityQuerySchema } from "@cairn/shared";
import { readNumericParam } from "../repositories/params.js";
import { findPlannedAndConfirmedByDate } from "../repositories/events.js";
import { buildFeasibilityParams, computeDayFeasibility } from "../services/feasibility.js";
import type { CairnDatabase } from "../db/index.js";

export function registerFeasibilityRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/feasibility/day", async (req, reply) => {
    const parsed = FeasibilityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { date, now } = parsed.data;

    const paramOverrides: Record<string, number> = {
      energyBudget: readNumericParam(db, "energy_budget", 8),
      meetBufferMinutes: readNumericParam(db, "meet_buffer", 15),
      deepBufferMinutes: readNumericParam(db, "deep_buffer", 30),
      travelMargin: readNumericParam(db, "travel_margin", 1),
      maxContinuousMinutes: readNumericParam(db, "max_continuous", 600)
    };
    const p = buildFeasibilityParams(paramOverrides);
    const events = findPlannedAndConfirmedByDate(db, date);
    const feasibility = computeDayFeasibility(date, now, events, p);

    return reply.send({ ok: true, data: feasibility });
  });
}
