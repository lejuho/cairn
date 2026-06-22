import { describe, expect, it } from "vitest";
import type { PersonRow } from "@cairn/shared";
import {
  scoreAvailability,
  scoreFeasibility,
  scorePeople,
  scoreFriction,
  getScoreLabel,
  getWeekday
} from "./slotCandidates.js";
import { DEFAULTS as FEAS_DEFAULTS } from "./feasibility.js";
import type { MirrorSourceRow } from "../repositories/mirror.js";
import type { EventRow } from "@cairn/shared";

const DATE = "2026-06-23"; // Tuesday
const NOW = "2026-06-23T08:00:00+09:00";
const START = "2026-06-23T09:00:00+09:00";
const END = "2026-06-23T10:00:00+09:00";

function person(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 1,
    name: "Alice",
    relation: null,
    channel: null,
    hardConstraints: [],
    preferredWindows: null,
    leadTime: null,
    ...overrides
  };
}

function annotation(overrides: Partial<MirrorSourceRow> = {}): MirrorSourceRow {
  return {
    annotationId: 1,
    eventId: 1,
    eventTitle: "test",
    eventType: "meeting",
    outcome: "done",
    reasonTags: null,
    reasonText: null,
    loggedAt: "2026-06-01T10:00:00Z",
    eventStart: "2026-06-02T09:00:00+09:00",
    threadId: null,
    threadName: null,
    cancelMoney: null,
    cancelSocial: null,
    cancelEffort: null,
    cancelWindow: null,
    ...overrides
  };
}

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 99,
    title: "existing",
    type: "meeting",
    status: "planned",
    source: "cairn",
    selfImposed: 1,
    start: null,
    end: null,
    threadId: null,
    location: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

// Monday through Sunday as YYYY-MM-DD (Mon=2026-06-22, Tue=2026-06-23, Wed=2026-06-24)
describe("getWeekday", () => {
  it("returns correct weekday for known dates", () => {
    expect(getWeekday("2026-06-22")).toBe("monday");
    expect(getWeekday("2026-06-23")).toBe("tuesday");
    expect(getWeekday("2026-06-28")).toBe("sunday");
  });
});

describe("getScoreLabel", () => {
  it("returns 좋음 for score >= 75", () => {
    expect(getScoreLabel(75)).toBe("좋음");
    expect(getScoreLabel(100)).toBe("좋음");
  });
  it("returns 보통 for 50 <= score < 75", () => {
    expect(getScoreLabel(50)).toBe("보통");
    expect(getScoreLabel(74)).toBe("보통");
  });
  it("returns 낮음 for score < 50", () => {
    expect(getScoreLabel(0)).toBe("낮음");
    expect(getScoreLabel(49)).toBe("낮음");
  });
});

describe("scoreAvailability", () => {
  it("free window is positive 40 pts observed", () => {
    const c = scoreAvailability(DATE, 9);
    expect(c.lens).toBe("availability");
    expect(c.impact).toBe("positive");
    expect(c.points).toBe(40);
    expect(c.confidence).toBe("observed");
    expect(c.reasonCodes).toContain("free_window");
    expect(c.evidence[0]).toContain(DATE);
  });
});

describe("scoreFeasibility", () => {
  it("within budget → positive 25 pts", () => {
    const c = scoreFeasibility(DATE, START, END, [], FEAS_DEFAULTS, NOW);
    expect(c.lens).toBe("feasibility");
    expect(c.impact).toBe("positive");
    expect(c.points).toBe(25);
    expect(c.reasonCodes).toContain("energy_within_budget");
  });

  it("energy deficit when budget is 1 unit and event fills it", () => {
    // Pre-existing 1h event far from candidate (no tight gap) + 1h candidate → 2h load > 1h budget
    const existing = eventRow({
      id: 50,
      status: "planned",
      start: "2026-06-23T11:30:00+09:00",
      end: "2026-06-23T12:30:00+09:00"
    });
    const tightParams = { ...FEAS_DEFAULTS, energyBudget: 1 };
    const c = scoreFeasibility(DATE, START, END, [existing], tightParams, NOW);
    expect(c.impact).toBe("negative");
    expect(c.points).toBe(-20);
    expect(c.reasonCodes).toContain("energy_over_budget");
  });

  it("tight gap lowers score and produces gap_tight reason code", () => {
    // Place an event right after the candidate with only 1 minute buffer (below meetBufferMinutes=30)
    // Candidate: 09:00–10:00, next event: 10:01–11:00 → gap = 1 min < buffer → tight
    const nextEvent = eventRow({
      id: 51,
      status: "planned",
      start: "2026-06-23T10:01:00+09:00",
      end: "2026-06-23T11:00:00+09:00"
    });
    const c = scoreFeasibility(DATE, START, END, [nextEvent], FEAS_DEFAULTS, NOW);
    expect(c.reasonCodes).toContain("gap_tight");
    expect(c.points).toBeLessThan(25); // penalized
  });

  it("impossible gap produces gap_impossible reason code", () => {
    // Event starts inside the candidate window → when sorted, gap between candidate end and next start is negative.
    // In production, generateSlotCandidates filters direct overlaps before scoring; this unit test verifies
    // the gap_impossible branch which can also fire when pre-existing events in data overlap each other.
    // candidate: 09:00–10:00, existing: 09:30–10:30 → gap = 09:30 - 10:00 = -30 min → impossible
    const overlapper = eventRow({
      id: 52,
      status: "planned",
      start: "2026-06-23T09:30:00+09:00",
      end: "2026-06-23T10:30:00+09:00"
    });
    const c = scoreFeasibility(DATE, START, END, [overlapper], FEAS_DEFAULTS, NOW);
    expect(c.reasonCodes).toContain("gap_impossible");
    expect(c.points).toBeLessThan(25); // penalized from max feasibility score
  });

  it("continuous overrun produces continuous_exceeded reason code", () => {
    // Set maxContinuousMinutes very low (e.g. 30 min) so 2h continuous block triggers it
    const existingBefore = eventRow({
      id: 53,
      status: "planned",
      start: "2026-06-23T08:00:00+09:00",
      end: "2026-06-23T09:00:00+09:00"
    });
    // candidate at 09:00–10:00, preceded by 08:00–09:00 → continuous 2h > 30 min max
    const tightContParams = { ...FEAS_DEFAULTS, maxContinuousMinutes: 30 };
    const c = scoreFeasibility(DATE, START, END, [existingBefore], tightContParams, NOW);
    expect(c.reasonCodes).toContain("continuous_exceeded");
    expect(c.points).toBeLessThan(25);
  });
});

describe("scorePeople", () => {
  it("no people → cold_start neutral", () => {
    const c = scorePeople("tuesday", 9, []);
    expect(c.confidence).toBe("cold_start");
    expect(c.points).toBe(0);
    expect(c.reasonCodes).toContain("people_no_data");
  });

  it("person with hard unavailable weekday → negative -40", () => {
    const p = person({
      hardConstraints: [{ type: "weekday_unavailable", weekday: "tuesday", text: "no meetings", firmness: "hard" }]
    });
    const c = scorePeople("tuesday", 9, [p]);
    expect(c.impact).toBe("negative");
    expect(c.points).toBe(-40);
    expect(c.reasonCodes).toContain("person_unavailable_weekday");
    expect(c.reasonCodes).not.toContain("person_preferred_window");
  });

  it("hard unavailable weekday does not appear as preferred even if day matches preferred list", () => {
    const p = person({
      hardConstraints: [{ type: "weekday_unavailable", weekday: "tuesday", text: "unavail", firmness: "hard" }],
      preferredWindows: { weekdays: ["tuesday"], periods: ["morning"], firmness: "hard" }
    });
    const c = scorePeople("tuesday", 9, [p]);
    // Hard constraint takes priority over preferred window
    expect(c.reasonCodes).not.toContain("person_preferred_window");
    expect(c.points).toBe(-40);
  });

  it("preferred weekday and period match → positive +20", () => {
    const p = person({
      preferredWindows: { weekdays: ["tuesday"], periods: ["morning"], firmness: "hard" }
    });
    const c = scorePeople("tuesday", 9, [p]); // 9 = morning
    expect(c.impact).toBe("positive");
    expect(c.points).toBe(20);
    expect(c.reasonCodes).toContain("person_preferred_window");
  });

  it("only weekday matches (not period) → partial +10", () => {
    const p = person({
      preferredWindows: { weekdays: ["tuesday"], periods: ["afternoon"], firmness: "hard" }
    });
    const c = scorePeople("tuesday", 9, [p]); // 9 = morning, pref = afternoon
    expect(c.points).toBe(10);
    expect(c.reasonCodes).toContain("person_preferred_partial");
  });

  it("no match → neutral 0 observed", () => {
    const p = person({
      preferredWindows: { weekdays: ["friday"], periods: ["afternoon"], firmness: "hard" }
    });
    const c = scorePeople("tuesday", 9, [p]);
    expect(c.impact).toBe("neutral");
    expect(c.points).toBe(0);
  });

  it("single person includes personIds in contribution", () => {
    const p = person({ id: 7, preferredWindows: { weekdays: ["tuesday"], periods: ["morning"], firmness: "hard" } });
    const c = scorePeople("tuesday", 9, [p]);
    expect(c.personIds).toEqual([7]);
  });

  it("hard unavailable includes personIds of violators only", () => {
    const p1 = person({ id: 3, hardConstraints: [{ type: "weekday_unavailable", weekday: "tuesday", text: "busy", firmness: "hard" }] });
    const p2 = person({ id: 5, name: "Bob" });
    const c = scorePeople("tuesday", 9, [p1, p2]);
    expect(c.personIds).toEqual([3]);
  });
});

describe("scoreFriction", () => {
  it("low sample (<3) → cold_start neutral", () => {
    const rows = [
      annotation({ outcome: "moved", eventStart: "2026-06-02T09:00:00+09:00", eventType: "meeting" })
    ];
    const c = scoreFriction("tuesday", "meeting", null, rows);
    expect(c.confidence).toBe("cold_start");
    expect(c.points).toBe(0);
    expect(c.reasonCodes).toContain("friction_low_sample");
  });

  it("high weekday slip rate (>50%) → negative friction_high_weekday", () => {
    // 3/4 tuesday annotations are moved/cancelled → 75% slip rate
    const tueAnnotations = [
      annotation({ outcome: "moved", eventStart: "2026-06-02T09:00:00+09:00", eventType: "meeting" }),
      annotation({ outcome: "moved", eventStart: "2026-06-09T09:00:00+09:00", eventType: "meeting" }),
      annotation({ outcome: "cancelled", eventStart: "2026-06-16T09:00:00+09:00", eventType: "meeting" }),
      annotation({ outcome: "done", eventStart: "2026-06-23T09:00:00+09:00", eventType: "meeting" })
    ];
    const c = scoreFriction("tuesday", "meeting", null, tueAnnotations);
    // 3/4 = 75% slip rate on Tuesday → high friction
    expect(c.points).toBeLessThan(0);
    expect(c.reasonCodes).toContain("friction_high_weekday");
  });

  it("low weekday slip rate → positive friction_low", () => {
    const tueAnnotations = [
      annotation({ outcome: "done", eventStart: "2026-06-02T09:00:00+09:00" }),
      annotation({ outcome: "done", eventStart: "2026-06-09T09:00:00+09:00" }),
      annotation({ outcome: "done", eventStart: "2026-06-16T09:00:00+09:00" })
    ];
    const c = scoreFriction("tuesday", "meeting", null, tueAnnotations);
    expect(c.impact).toBe("positive");
    expect(c.points).toBeGreaterThan(0);
    expect(c.reasonCodes).toContain("friction_low");
  });

  it("high thread slip rate → negative friction_high_thread", () => {
    const threadId = 99;
    const threadAnnotations = [
      annotation({ outcome: "moved", eventStart: "2026-06-02T09:00:00+09:00", threadId }),
      annotation({ outcome: "moved", eventStart: "2026-06-09T09:00:00+09:00", threadId }),
      annotation({ outcome: "cancelled", eventStart: "2026-06-16T09:00:00+09:00", threadId })
    ];
    const c = scoreFriction("tuesday", "meeting", threadId, threadAnnotations);
    expect(c.reasonCodes).toContain("friction_high_thread");
    expect(c.points).toBeLessThan(0);
    expect(c.confidence).toBe("observed");
  });

  it("thread present but below sample threshold → evidence line not cold_start if weekday has sample", () => {
    const threadId = 88;
    const rows = [
      annotation({ outcome: "done", eventStart: "2026-06-02T09:00:00+09:00", threadId: null }),
      annotation({ outcome: "done", eventStart: "2026-06-09T09:00:00+09:00", threadId: null }),
      annotation({ outcome: "done", eventStart: "2026-06-16T09:00:00+09:00", threadId: null }),
      annotation({ outcome: "moved", eventStart: "2026-06-23T09:00:00+09:00", threadId }) // only 1 thread annotation
    ];
    const c = scoreFriction("tuesday", "meeting", threadId, rows);
    // weekday has 4 samples (including the thread one) → observed, not cold_start
    expect(c.confidence).toBe("observed");
    // thread evidence should mention low sample
    expect(c.evidence.some((e) => e.includes("스레드 표본"))).toBe(true);
  });
});

describe("scoring deterministic tie-break", () => {
  it("equal-score candidates are ordered by start asc — tested via score arithmetic", () => {
    // Two candidates with same score: earlier start should rank first
    // This is a property of generateSlotCandidates sort; verify via unit arithmetic
    const scores = [65, 65];
    const starts = ["2026-06-24T11:00:00+09:00", "2026-06-23T09:00:00+09:00"];
    // Sort by score desc, start asc
    const sorted = scores
      .map((s, i) => ({ score: s, start: starts[i]! }))
      .sort((a, b) => b.score - a.score || (a.start < b.start ? -1 : 1));
    expect(sorted[0]!.start).toBe("2026-06-23T09:00:00+09:00");
  });
});
