import type { FastifyInstance } from "fastify";
import {
  FeasibilityQuerySchema,
  UpdateFeasibilityParamsRequestSchema,
  PreviewFeasibilityRequestSchema
} from "@cairn/shared";
import { readNumericParam } from "../repositories/params.js";
import { findPlannedAndConfirmedByDate } from "../repositories/events.js";
import { findThreadLinksAmong } from "../repositories/threads.js";
import { findEventDependencyLinks } from "../repositories/links.js";
import { buildFeasibilityParams, computeDayFeasibility, dayScheduledEvents } from "../services/feasibility.js";
import { dayEventIds, dayThreadIds } from "../services/feasibility.js";
import { buildDayTravelFacts } from "../services/travel-time.js";
import {
  readFeasibilityParamSettings,
  writeFeasibilityParams
} from "../services/feasibility-params.js";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway } from "../maps/gateway.js";

export function registerFeasibilityRoutes(app: FastifyInstance, db: CairnDatabase, mapGateway?: MapGateway): void {
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
    const dependencyLinks = findEventDependencyLinks(db, dayEventIds(events, date));
    // Cache/gateway-backed travel evidence (cycle-76). allowProvider=true: a fresh
    // cache row is reused; an eligible pair may refresh once. Provider failure →
    // unavailable evidence (fail open), never a non-200.
    const travelFacts = await buildDayTravelFacts(db, mapGateway, dayScheduledEvents(events, date), p, now, { allowProvider: true });
    const feasibility = computeDayFeasibility(date, now, events, p, relations, dependencyLinks, travelFacts);

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
    // Use supplied params directly — no param write. thread_links + dependency
    // links are reads only.
    const events = findPlannedAndConfirmedByDate(db, date);
    const relations = findThreadLinksAmong(db, dayThreadIds(events, date));
    const dependencyLinks = findEventDependencyLinks(db, dayEventIds(events, date));
    // Preview is CACHE-READ-ONLY (allowProvider=false): it reads existing travel
    // cache rows but never calls the provider or writes a row, so exploring
    // parameters cannot mutate the cache or any event/thread.
    const travelFacts = await buildDayTravelFacts(db, mapGateway, dayScheduledEvents(events, date), reqParams, now, { allowProvider: false });
    const feasibility = computeDayFeasibility(date, now, events, reqParams, relations, dependencyLinks, travelFacts);
    return reply.send({ ok: true, data: feasibility });
  });
}
