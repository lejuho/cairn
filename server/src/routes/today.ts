import type { FastifyInstance } from "fastify";
import { TodayQuerySchema } from "@cairn/shared";
import { findPlannedAndConfirmedByDate, findUnscheduledCairnEvents } from "../repositories/events.js";
import { readNumericParam } from "../repositories/params.js";
import { findDueTaskSchedulePrompts, findTwoMinuteTodoTasks } from "../repositories/tasks.js";
import { findAllWatchersForEvaluation, findTaskStatusesByIds } from "../repositories/watchers.js";
import { parseReversePlanRule } from "../services/watcher-reverse-plan.js";
import { buildFeasibilityParams, computeDayFeasibility, dayEventIds, dayThreadIds } from "../services/feasibility.js";
import { findThreadIdsByDomain, findThreadLinksAmong } from "../repositories/threads.js";
import { findEventDependencyLinks } from "../repositories/links.js";
import { listNeedsReviewEvents } from "../services/needsReview.js";
import { buildTodaySurface } from "../services/today.js";
import { buildTodayLocationContexts } from "../services/today-location-context.js";
import { buildDayTravelFacts, buildPinnedPairMap } from "../services/travel-time.js";
import { dayScheduledEvents } from "../services/feasibility.js";
import { findGeocodeByNormalizedSet } from "../repositories/geocode-cache.js";
import { normalizeLocation } from "../maps/normalize.js";
import type { MapGateway } from "../maps/gateway.js";
import { evaluateWatcherA } from "../services/watchers.js";
import type { CairnDatabase } from "../db/index.js";

export function registerTodayRoute(app: FastifyInstance, db: CairnDatabase, mapGateway?: MapGateway): void {
  app.get("/api/today", async (req, reply) => {
    const parsed = TodayQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { date, now, domain } = parsed.data;

    const rawDayEvents = findPlannedAndConfirmedByDate(db, date);
    const rawTwoMinuteTasks = findTwoMinuteTodoTasks(db);
    const watcherRows = findAllWatchersForEvaluation(db);
    const rpTaskIds: number[] = [];
    for (const row of watcherRows) {
      const rule = parseReversePlanRule(row.rule);
      if (rule) rpTaskIds.push(...rule.steps.map((s) => s.taskId));
    }
    const taskStatuses = findTaskStatusesByIds(db, rpTaskIds);
    const rawWatcherBubbles = evaluateWatcherA(watcherRows, date, now, taskStatuses);
    const rawNeedsReviewEvents = listNeedsReviewEvents(db, now);
    const rawUnscheduledEvents = findUnscheduledCairnEvents(db, date);
    const rawDueTaskSchedulePrompts = findDueTaskSchedulePrompts(db, date);

    // Domain filter (cycle-67 FR-DOM-01). When a domain is selected, keep only
    // thread-linked items whose thread is in that domain; threadless items
    // (including watchers) appear only in `all`. Applied to the INPUT sets BEFORE
    // feasibility/relations/surface construction, so cards, conflicts, and the
    // feasibility panel all reflect the same filtered set (not a UI-only hide).
    const domainThreadIds = domain === "all" ? null : findThreadIdsByDomain(db, domain);
    const inDomain = <T extends { threadId: number | null }>(rows: T[]): T[] =>
      domainThreadIds === null ? rows : rows.filter((r) => r.threadId != null && domainThreadIds.has(r.threadId));

    const dayEvents = inDomain(rawDayEvents);
    const twoMinuteTasks = inDomain(rawTwoMinuteTasks);
    const watcherBubbles = domainThreadIds === null ? rawWatcherBubbles : [];
    const needsReviewEvents = inDomain(rawNeedsReviewEvents);
    const unscheduledEvents = inDomain(rawUnscheduledEvents);
    const dueTaskSchedulePrompts = inDomain(rawDueTaskSchedulePrompts);

    const feasibilityParams = buildFeasibilityParams({
      energyBudget: readNumericParam(db, "energy_budget", 8),
      meetBufferMinutes: readNumericParam(db, "meet_buffer", 15),
      deepBufferMinutes: readNumericParam(db, "deep_buffer", 30),
      travelMargin: readNumericParam(db, "travel_margin", 1),
      maxContinuousMinutes: readNumericParam(db, "max_continuous", 600)
    });
    const relations = findThreadLinksAmong(db, dayThreadIds(dayEvents, date));
    const dependencyLinks = findEventDependencyLinks(db, dayEventIds(dayEvents, date));
    // Cache/gateway-backed travel evidence for adjacent scheduled pairs (cycle-76)
    // + user-pinned facts (cycle-78, which win over provider/cache for a matching
    // pair). Provider failure / disabled → unavailable evidence; Today still 200.
    const travelFacts = await buildDayTravelFacts(db, mapGateway, dayScheduledEvents(dayEvents, date), feasibilityParams, now, { allowProvider: true }, buildPinnedPairMap(db));
    const feasibility = computeDayFeasibility(date, now, dayEvents, feasibilityParams, relations, dependencyLinks, travelFacts);

    // Cache-only location context (cycle-75). Read existing geocode_cache rows
    // for the event-bearing rows (conflict pairs, next_event, schedule prompts all
    // derive from these three sets) — NO provider call, NO geocode POST, NO write.
    const contextEvents = [...dayEvents, ...needsReviewEvents, ...unscheduledEvents];
    const normalizedKeys = [
      ...new Set(
        contextEvents
          .map((e) => e.location)
          .filter((l): l is string => l != null && l.trim().length > 0)
          .map((l) => normalizeLocation(l))
      )
    ];
    const cacheRows = findGeocodeByNormalizedSet(db, normalizedKeys);
    const locationContexts = buildTodayLocationContexts(contextEvents, cacheRows);

    const surface = buildTodaySurface(date, now, dayEvents, twoMinuteTasks, watcherBubbles, needsReviewEvents, unscheduledEvents, dueTaskSchedulePrompts, feasibility, locationContexts);
    return reply.send({ ok: true, data: surface });
  });
}
