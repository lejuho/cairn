import type { FastifyInstance } from "fastify";
import { TodayQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedByDate, findUnscheduledCairnEvents } from "../repositories/events.js";
import { readNumericParam } from "../repositories/params.js";
import { findTwoMinuteTodoTasks } from "../repositories/tasks.js";
import { findFiredWatchers } from "../repositories/watchers.js";
import { buildFeasibilityParams, computeDayFeasibility } from "../services/feasibility.js";
import { listNeedsReviewEvents } from "../services/needsReview.js";
import { buildTodaySurface } from "../services/today.js";
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
    const watcherBubbles = findFiredWatchers(db, date, now);
    const needsReviewEvents = listNeedsReviewEvents(db, now);
    const unscheduledEvents = findUnscheduledCairnEvents(db);

    const feasibilityParams = buildFeasibilityParams({
      energyBudget: readNumericParam(db, "energy_budget", 8),
      meetBufferMinutes: readNumericParam(db, "meet_buffer", 15),
      deepBufferMinutes: readNumericParam(db, "deep_buffer", 30),
      travelMargin: readNumericParam(db, "travel_margin", 1),
      maxContinuousMinutes: readNumericParam(db, "max_continuous", 600)
    });
    const feasibility = computeDayFeasibility(date, now, dayEvents, feasibilityParams);

    const surface = buildTodaySurface(date, now, dayEvents, twoMinuteTasks, watcherBubbles, needsReviewEvents, unscheduledEvents, feasibility);
    return reply.send({ ok: true, data: surface });
  });
}
