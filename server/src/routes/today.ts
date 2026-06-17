import type { FastifyInstance } from "fastify";
import { TodayQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedByDate } from "../repositories/events.js";
import { findTwoMinuteTodoTasks } from "../repositories/tasks.js";
import { findFiredWatchers } from "../repositories/watchers.js";
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

    const surface = buildTodaySurface(date, now, dayEvents, twoMinuteTasks, watcherBubbles, needsReviewEvents);
    return reply.send({ ok: true, data: surface });
  });
}
