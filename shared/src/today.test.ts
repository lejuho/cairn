import { describe, expect, it } from "vitest";
import { NeedsReviewPlacementSchema, TodaySurfaceSchema } from "./today.js";

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
    needsReviewEvents: [EVENT], unscheduledEvents: [], dayEvents: [EVENT],
    feasibility: FEASIBILITY
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
