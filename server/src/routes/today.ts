import type { FastifyInstance } from "fastify";
import { TodayQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedByDate, findUnscheduledCairnEvents } from "../repositories/events.js";
import { readNumericParam } from "../repositories/params.js";
import { findTwoMinuteTodoTasks } from "../repositories/tasks.js";
import { findAllWatchersForEvaluation, findTaskStatusesByIds } from "../repositories/watchers.js";
import { parseReversePlanRule } from "../services/watcher-reverse-plan.js";
import { buildFeasibilityParams, computeDayFeasibility, dayEventIds, dayThreadIds } from "../services/feasibility.js";
import { findThreadLinksAmong } from "../repositories/threads.js";
import { findEventDependencyLinks } from "../repositories/links.js";
import { listNeedsReviewEvents } from "../services/needsReview.js";
import { buildTodaySurface } from "../services/today.js";
import { evaluateWatcherA } from "../services/watchers.js";
import type { CairnDatabase } from "../db/index.js";

export function registerTodayRoute(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/today", async (req, reply) => {
    const parsed = TodayQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { date, now } = parsed.data;

    const dayEvents = findPlannedAndConfirmedByDate(db, date);
    const twoMinuteTasks = findTwoMinuteTodoTasks(db);
    const watcherRows = findAllWatchersForEvaluation(db);
    const rpTaskIds: number[] = [];
    for (const row of watcherRows) {
      const rule = parseReversePlanRule(row.rule);
      if (rule) rpTaskIds.push(...rule.steps.map((s) => s.taskId));
    }
    const taskStatuses = findTaskStatusesByIds(db, rpTaskIds);
    const watcherBubbles = evaluateWatcherA(watcherRows, date, now, taskStatuses);
    const needsReviewEvents = listNeedsReviewEvents(db, now);
    const unscheduledEvents = findUnscheduledCairnEvents(db, date);

    const feasibilityParams = buildFeasibilityParams({
      energyBudget: readNumericParam(db, "energy_budget", 8),
      meetBufferMinutes: readNumericParam(db, "meet_buffer", 15),
      deepBufferMinutes: readNumericParam(db, "deep_buffer", 30),
      travelMargin: readNumericParam(db, "travel_margin", 1),
      maxContinuousMinutes: readNumericParam(db, "max_continuous", 600)
    });
    const relations = findThreadLinksAmong(db, dayThreadIds(dayEvents, date));
    const dependencyLinks = findEventDependencyLinks(db, dayEventIds(dayEvents, date));
    const feasibility = computeDayFeasibility(date, now, dayEvents, feasibilityParams, relations, dependencyLinks);

    const surface = buildTodaySurface(date, now, dayEvents, twoMinuteTasks, watcherBubbles, needsReviewEvents, unscheduledEvents, feasibility);
    return reply.send({ ok: true, data: surface });
  });
}
