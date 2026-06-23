import type { FastifyInstance } from "fastify";
import {
  CreateManualExogenousWatcherRequestSchema,
  CreateReversePlanWatcherRequestSchema,
  CreateWatcherManualLogRequestSchema,
  CreateWatcherRequestSchema,
  PatchWatcherArmedRequestSchema,
  PatchWatcherSnoozeRequestSchema,
  WatchersQuerySchema
} from "@cairn/shared";
import type { WatcherLogSummary } from "@cairn/shared";
import {
  createManualExogenousWatcher,
  createReversePlanWatcher,
  createWatcher,
  findAllWatchers,
  findTaskStatusesByIds,
  findWatcherLogSummary,
  insertWatcherLog,
  setWatcherArmed,
  snoozeWatcher
} from "../repositories/watchers.js";
import { buildWatcherDeepView } from "../services/watcher-deep-view.js";
import { parseManualExogenousRule } from "../services/watcher-manual-exogenous.js";
import { parseReversePlanRule } from "../services/watcher-reverse-plan.js";
import type { CairnDatabase } from "../db/index.js";

export function registerWatcherRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/watchers", async (req, reply) => {
    const parsed = WatchersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const { date, now } = parsed.data;
    const rows = findAllWatchers(db);

    // Collect all task IDs referenced by reverse-plan rules
    const taskIds: number[] = [];
    for (const row of rows) {
      const rule = parseReversePlanRule(row.rule);
      if (rule) {
        taskIds.push(...rule.steps.map((s) => s.taskId));
        taskIds.push(rule.targetTaskId);
      }
    }
    const taskStatuses = findTaskStatusesByIds(db, taskIds);

    // Build log summaries for manual-exogenous (kind=B) watchers
    const logSummaries = new Map<number, WatcherLogSummary>();
    for (const row of rows) {
      if (row.kind === "B" && parseManualExogenousRule(row.rule) !== null) {
        logSummaries.set(row.id, findWatcherLogSummary(db, row.id));
      }
    }

    const allWatchers = buildWatcherDeepView(rows, date, now, taskStatuses, logSummaries);
    return reply.send({ ok: true, data: { watchers: allWatchers } });
  });

  app.patch("/api/watchers/:id/armed", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }
    const parsed = PatchWatcherArmedRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const watcher = setWatcherArmed(db, id, parsed.data.armed);
    if (!watcher) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `watcher ${id} not found` }
      });
    }
    return reply.send({ ok: true, data: watcher });
  });

  app.post("/api/watchers", async (req, reply) => {
    const parsed = CreateWatcherRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    try {
      const watcher = createWatcher(db, parsed.data);
      return reply.code(201).send({ ok: true, data: watcher });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });

  app.post("/api/watchers/manual-exogenous", async (req, reply) => {
    const parsed = CreateManualExogenousWatcherRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    try {
      const result = createManualExogenousWatcher(db, parsed.data);
      return reply.code(201).send({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: msg } });
    }
  });

  app.post("/api/watchers/:id/manual-log", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }
    const parsed = CreateWatcherManualLogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    try {
      const result = insertWatcherLog(db, id, parsed.data);
      return reply.code(201).send({ ok: true, data: result });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NOT_FOUND") {
        return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: `watcher ${id} not found` } });
      }
      if (code === "WRONG_WATCHER_TYPE") {
        return reply.code(409).send({ ok: false, error: { code: "WRONG_WATCHER_TYPE", message: `watcher ${id} is not manual_exogenous` } });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: msg } });
    }
  });

  app.post("/api/watchers/reverse-plan", async (req, reply) => {
    const parsed = CreateReversePlanWatcherRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    try {
      const result = createReversePlanWatcher(db, parsed.data);
      return reply.code(201).send({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });

  app.patch("/api/watchers/:id/snooze", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const parsed = PatchWatcherSnoozeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const watcher = snoozeWatcher(db, id, parsed.data.snoozedUntil);
    if (!watcher) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `watcher ${id} not found` }
      });
    }

    return reply.send({ ok: true, data: watcher });
  });
}
