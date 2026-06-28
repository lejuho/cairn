import { describe, expect, it } from "vitest";
import { NeedsReviewPlacementSchema, TodayEventLocationContextSchema, TodayQuerySchema, TodaySurfaceSchema } from "./today.js";

describe("TodayQuerySchema domain (cycle-67 FR-DOM-01)", () => {
  const base = { date: "2026-06-27", now: "2026-06-27T09:00:00+09:00" };
  it("defaults domain to all when omitted", () => {
    const r = TodayQuerySchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.domain).toBe("all");
  });
  it("accepts all|personal|work and rejects invalid", () => {
    for (const d of ["all", "personal", "work"]) {
      expect(TodayQuerySchema.safeParse({ ...base, domain: d }).success).toBe(true);
    }
    expect(TodayQuerySchema.safeParse({ ...base, domain: "office" }).success).toBe(false);
    expect(TodayQuerySchema.safeParse({ ...base, domain: "Personal" }).success).toBe(false);
  });
});

const EVENT = {
  id: 1, threadId: null, title: "회의", type: null,
  start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
  location: null, mode: null, source: "cairn", selfImposed: 1, status: "done",
  createdAt: null, updatedAt: null
};

const FEASIBILITY = {
  date: "2026-06-20", now: "2026-06-20T22:00:00+09:00",
  params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
  energy: { loadUnits: 1, budgetUnits: 8, remainingUnits: 7, deficit: false, confidence: "cold_start" },
  gaps: [], continuous: null, transitionCosts: [],
  sequenceEnergy: {
    workLoadUnits: 1, transitionLoadUnits: 0, totalLoadUnits: 1, budgetUnits: 8, remainingUnits: 7,
    deficit: false, unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"]
  },
  sequenceOrder: {
    scope: "day_scheduled_events", currentOrder: [], candidateOrder: [], orderChanged: false,
    hardEdges: [], softEdges: [], violations: [], parallelGroups: [], criticalPath: [],
    cycleDetected: false, reasonCodes: []
  }
};

describe("NeedsReviewPlacementSchema", () => {
  const VALID = { mode: "low_context_slot", anchorEventId: 5, ageHours: 3, reasonCodes: ["placement_low_context_slot"] };

  it("accepts low_context_slot with anchor", () => {
    expect(NeedsReviewPlacementSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts stale_due with null anchor", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ mode: "stale_due", anchorEventId: null, ageHours: 14, reasonCodes: ["placement_stale_due"] }).success).toBe(true);
  });

  it("accepts no_context with null age", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ mode: "no_context", anchorEventId: null, ageHours: null, reasonCodes: ["placement_no_context"] }).success).toBe(true);
  });

  it("rejects invalid mode", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, mode: "deferred" }).success).toBe(false);
  });

  it("rejects negative ageHours", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, ageHours: -1 }).success).toBe(false);
  });

  it("rejects non-integer ageHours", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, ageHours: 3.5 }).success).toBe(false);
  });

  it("rejects injected recommendation/autoAction/delayUntil/score (strict)", () => {
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, recommendation: "review now" }).success).toBe(false);
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, autoAction: "complete" }).success).toBe(false);
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, delayUntil: "2026-06-21" }).success).toBe(false);
    expect(NeedsReviewPlacementSchema.safeParse({ ...VALID, score: 9 }).success).toBe(false);
  });
});

describe("TodaySurfaceSchema needs_review card", () => {
  const baseSurface = {
    date: "2026-06-20", now: "2026-06-20T22:00:00+09:00", state: "live" as const,
    nextEvent: null, conflicts: [], twoMinuteTasks: [], watcherBubbles: [],
    needsReviewEvents: [EVENT], unscheduledEvents: [], dueTaskSchedulePrompts: [], dayEvents: [EVENT],
    feasibility: FEASIBILITY, locationContexts: []
  };

  it("requires placement on needs_review cards", () => {
    const withoutPlacement = {
      ...baseSurface,
      cards: [{ kind: "needs_review", event: EVENT }]
    };
    expect(TodaySurfaceSchema.safeParse(withoutPlacement).success).toBe(false);
  });

  it("accepts needs_review card with placement", () => {
    const withPlacement = {
      ...baseSurface,
      cards: [{ kind: "needs_review", event: EVENT, placement: { mode: "no_context", anchorEventId: null, ageHours: 1, reasonCodes: ["placement_no_context"] } }]
    };
    expect(TodaySurfaceSchema.safeParse(withPlacement).success).toBe(true);
  });

  it("keeps needsReviewEvents as plain event array (no placement)", () => {
    const ok = {
      ...baseSurface,
      cards: []
    };
    const parsed = TodaySurfaceSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.needsReviewEvents[0]).not.toHaveProperty("placement");
    }
  });
});

describe("TodaySurfaceSchema task_schedule_prompt card (cycle-62)", () => {
  const TASK = {
    id: 7, threadId: null, title: "보고서", estMinutes: 90, due: "2026-06-20",
    context: null, status: "todo", optional: 0, createdAt: null
  };
  const baseSurface = {
    date: "2026-06-20", now: "2026-06-20T22:00:00+09:00", state: "live" as const,
    nextEvent: null, conflicts: [], twoMinuteTasks: [], watcherBubbles: [],
    needsReviewEvents: [], unscheduledEvents: [], dueTaskSchedulePrompts: [TASK], dayEvents: [],
    feasibility: FEASIBILITY, locationContexts: []
  };

  it("accepts a task_schedule_prompt card and dueTaskSchedulePrompts array", () => {
    const ok = { ...baseSurface, cards: [{ kind: "task_schedule_prompt", task: TASK }] };
    expect(TodaySurfaceSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a task_schedule_prompt card carrying an event instead of a task", () => {
    const bad = { ...baseSurface, cards: [{ kind: "task_schedule_prompt", event: EVENT }] };
    expect(TodaySurfaceSchema.safeParse(bad).success).toBe(false);
  });

  it("requires the dueTaskSchedulePrompts field", () => {
    const withoutField: Record<string, unknown> = { ...baseSurface, cards: [] };
    delete withoutField.dueTaskSchedulePrompts;
    expect(TodaySurfaceSchema.safeParse(withoutField).success).toBe(false);
  });

  it("accepts a task row carrying schedulePromptDismissedOn", () => {
    const ok = { ...baseSurface, dueTaskSchedulePrompts: [{ ...TASK, schedulePromptDismissedOn: "2026-06-19" }], cards: [] };
    expect(TodaySurfaceSchema.safeParse(ok).success).toBe(true);
  });
});

describe("TodayEventLocationContext (cycle-75)", () => {
  const RESOLVED = {
    eventId: 1, locationText: "서울타워", status: "resolved", provider: "google",
    displayLabel: "N Seoul Tower", latitude: 37.55, longitude: 126.98,
    confidence: "high", providerStatus: "OK", uncertainty: { locationType: "ROOFTOP", partialMatch: false },
    updatedAt: null, lastCheckedAt: "2026-06-28T00:00:00"
  };

  it("accepts every context status", () => {
    expect(TodayEventLocationContextSchema.safeParse(RESOLVED).success).toBe(true);
    const blank = { ...RESOLVED, status: "missing", locationText: null, provider: null, displayLabel: null, latitude: null, longitude: null, confidence: null, providerStatus: null, uncertainty: null, lastCheckedAt: null };
    expect(TodayEventLocationContextSchema.safeParse(blank).success).toBe(true);
    const uncached = { ...blank, status: "uncached", locationText: "어딘가" };
    expect(TodayEventLocationContextSchema.safeParse(uncached).success).toBe(true);
    for (const status of ["ambiguous", "zero_results", "failed"]) {
      const c = { ...RESOLVED, status, latitude: null, longitude: null, displayLabel: null, confidence: "unknown", uncertainty: status === "ambiguous" ? { resultCount: 2, candidateLabels: ["A", "B"] } : null };
      expect(TodayEventLocationContextSchema.safeParse(c).success).toBe(true);
    }
  });

  it("rejects invalid status / injected field (strict)", () => {
    expect(TodayEventLocationContextSchema.safeParse({ ...RESOLVED, status: "checking" }).success).toBe(false);
    expect(TodayEventLocationContextSchema.safeParse({ ...RESOLVED, providerResultId: "p1" }).success).toBe(false);
    expect(TodayEventLocationContextSchema.safeParse({ ...RESOLVED, uncertainty: { error_message: "x" } }).success).toBe(false);
  });

  it("TodaySurfaceSchema requires the locationContexts field and accepts contexts", () => {
    const base = {
      date: "2026-06-20", now: "2026-06-20T22:00:00+09:00", state: "live" as const,
      nextEvent: null, conflicts: [], twoMinuteTasks: [], watcherBubbles: [],
      needsReviewEvents: [], unscheduledEvents: [], dueTaskSchedulePrompts: [], dayEvents: [], cards: [],
      feasibility: FEASIBILITY
    };
    const withoutField: Record<string, unknown> = { ...base };
    expect(TodaySurfaceSchema.safeParse(withoutField).success).toBe(false);
    expect(TodaySurfaceSchema.safeParse({ ...base, locationContexts: [RESOLVED] }).success).toBe(true);
  });
});
