import type { FastifyInstance } from "fastify";
import {
  FeasibilityQuerySchema,
  UpdateFeasibilityParamsRequestSchema,
  PreviewFeasibilityRequestSchema
} from "@cairn/shared";
import { readNumericParam } from "../repositories/params.js";
import { findPlannedAndConfirmedByDate } from "../repositories/events.js";
import { findThreadLinksAmong } from "../repositories/threads.js";
import { buildFeasibilityParams, computeDayFeasibility } from "../services/feasibility.js";
import { dayThreadIds } from "../services/feasibility.js";
import {
  readFeasibilityParamSettings,
  writeFeasibilityParams
} from "../services/feasibility-params.js";
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
    const relations = findThreadLinksAmong(db, dayThreadIds(events, date));
    const feasibility = computeDayFeasibility(date, now, events, p, relations);

    return reply.send({ ok: true, data: feasibility });
  });

  app.get("/api/feasibility/params", async (_req, reply) => {
    const settings = readFeasibilityParamSettings(db);
    return reply.send({ ok: true, data: settings });
  });

  app.put("/api/feasibility/params", async (req, reply) => {
    const parsed = UpdateFeasibilityParamsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    writeFeasibilityParams(db, parsed.data);
    const settings = readFeasibilityParamSettings(db);
    return reply.send({ ok: true, data: settings });
  });

  app.post("/api/feasibility/day/preview", async (req, reply) => {
    const parsed = PreviewFeasibilityRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const { date, now, params: reqParams } = parsed.data;
    // Use supplied params directly — no param write. thread_links is a read.
    const events = findPlannedAndConfirmedByDate(db, date);
    const relations = findThreadLinksAmong(db, dayThreadIds(events, date));
    const feasibility = computeDayFeasibility(date, now, events, reqParams, relations);
    return reply.send({ ok: true, data: feasibility });
  });
}
