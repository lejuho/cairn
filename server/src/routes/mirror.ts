import type { FastifyInstance } from "fastify";
import { MirrorEnergyTrendQuerySchema, MirrorLedgerQuerySchema, MirrorPatternsQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedAll } from "../repositories/events.js";
import { findAllOutcomeAnnotations, findMovedCancelledAnnotations } from "../repositories/mirror.js";
import { readNumericParam } from "../repositories/params.js";
import { buildMirrorLedger } from "../services/mirror-ledger.js";
import { buildMirrorPatterns } from "../services/mirror-patterns.js";
import { buildMirrorEnergyTrends } from "../services/mirror-energy-trends.js";
import type { CairnDatabase } from "../db/index.js";

export function registerMirrorRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/mirror/ledger", async (req, reply) => {
    const parsed = MirrorLedgerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const rows = findMovedCancelledAnnotations(db);
    const data = buildMirrorLedger(rows, {
      from: parsed.data.from,
      to: parsed.data.to,
      today: serverLocalToday()
    });
    return reply.send({ ok: true, data });
  });

  app.get("/api/mirror/patterns", async (req, reply) => {
    const parsed = MirrorPatternsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const rows = findAllOutcomeAnnotations(db);
    const data = buildMirrorPatterns(rows, {
      from: parsed.data.from,
      to: parsed.data.to,
      today: serverLocalToday()
    });
    return reply.send({ ok: true, data });
  });

  app.get("/api/mirror/energy-trends", async (req, reply) => {
    const parsed = MirrorEnergyTrendQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const paramOverrides: Record<string, number> = {
      energyBudget: readNumericParam(db, "energy_budget", 8),
      meetBufferMinutes: readNumericParam(db, "meet_buffer", 15),
      deepBufferMinutes: readNumericParam(db, "deep_buffer", 30),
      travelMargin: readNumericParam(db, "travel_margin", 1),
      maxContinuousMinutes: readNumericParam(db, "max_continuous", 600)
    };
    const evts = findPlannedAndConfirmedAll(db);
    const data = buildMirrorEnergyTrends(evts, {
      from: parsed.data.from,
      to: parsed.data.to,
      today: serverLocalToday(),
      paramOverrides
    });
    return reply.send({ ok: true, data });
  });
}

// Server-local calendar date. Date.now boundary stays at the route edge so the
// service remains pure/deterministic.
function serverLocalToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
