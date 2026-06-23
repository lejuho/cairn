import type { FastifyInstance } from "fastify";
import { MirrorAutomationNeedsQuerySchema, MirrorDiaryQuerySchema, MirrorEnergyTrendQuerySchema, MirrorLedgerQuerySchema, MirrorPatternsQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedAll } from "../repositories/events.js";
import { findAllOutcomeAnnotations, findMovedCancelledAnnotations } from "../repositories/mirror.js";
import { readNumericParam } from "../repositories/params.js";
import { findAllWatchers, findWatcherLogsInRange } from "../repositories/watchers.js";
import { buildMirrorLedger } from "../services/mirror-ledger.js";
import { buildMirrorPatterns } from "../services/mirror-patterns.js";
import { buildMirrorEnergyTrends, resolveTrendRange } from "../services/mirror-energy-trends.js";
import { buildAutomationNeeds } from "../services/mirror-automation-needs.js";
import { buildMirrorDiary } from "../services/mirror-diary.js";
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

    const today = serverLocalToday();
    const resolved = resolveTrendRange(parsed.data.from, parsed.data.to, today);
    const fromMs = Date.parse(`${resolved.from}T00:00:00Z`);
    const toMs = Date.parse(`${resolved.to}T00:00:00Z`);
    const diff = (toMs - fromMs) / 86_400_000;
    if (diff < 0 || diff > 89) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "range must not exceed 90 days" }
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
      today,
      paramOverrides
    });
    return reply.send({ ok: true, data });
  });

  app.get("/api/mirror/automation-needs", async (req, reply) => {
    const parsed = MirrorAutomationNeedsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const today = serverLocalToday();
    const defaultFrom = dateSubtractDays(today, 29);
    const from = parsed.data.from ?? defaultFrom;
    const to = parsed.data.to ?? today;

    const watcherRows = findAllWatchers(db);
    const manualBIds = watcherRows.filter((w) => w.kind === "B").map((w) => w.id);
    const logRows = findWatcherLogsInRange(db, manualBIds, from, to);

    const data = buildAutomationNeeds(watcherRows, logRows, { from, to });
    return reply.send({ ok: true, data });
  });

  app.get("/api/mirror/diary", async (req, reply) => {
    const parsed = MirrorDiaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const today = serverLocalToday();
    const from = parsed.data.from ?? dateSubtractDays(today, 29);
    const to = parsed.data.to ?? today;

    // Re-validate resolved range (schema only checks both-bound cases).
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    const diff = (toMs - fromMs) / 86_400_000;
    if (diff < 0 || diff > 89) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "range must not exceed 90 days" }
      });
    }

    const rows = findAllOutcomeAnnotations(db);
    const data = buildMirrorDiary(rows, { from, to });
    return reply.send({ ok: true, data });
  });
}

function dateSubtractDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
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
