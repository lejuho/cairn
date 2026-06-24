import { describe, expect, it } from "vitest";
import type { EventRow, TransitionCost } from "@cairn/shared";
import { computeNeedsReviewPlacement } from "./needsReviewPlacement.js";

function ev(id: number, end: string | null): EventRow {
  return {
    id, threadId: null, title: `E${id}`, type: null,
    start: null, end, location: null, mode: null, source: "cairn",
    selfImposed: 1, status: "done", createdAt: null, updatedAt: null
  };
}

function tcost(fromEventId: number, toEventId: number, costLevel: TransitionCost["costLevel"]): TransitionCost {
  return {
    fromEventId, toEventId, fromThreadId: 1, toThreadId: 2,
    relation: costLevel === "none" ? "same_thread" : costLevel === "unknown" ? "missing_thread" : "unrelated",
    costLevel, reasonCodes: []
  };
}

const NOW = "2026-06-20T22:00:00+09:00";

describe("computeNeedsReviewPlacement — low_context_slot", () => {
  it("low-cost adjacent transition (event is from) → low_context_slot with anchor=to", () => {
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "low")], NOW);
    expect(p.mode).toBe("low_context_slot");
    expect(p.anchorEventId).toBe(2);
    expect(p.reasonCodes).toEqual(["placement_low_context_slot"]);
  });

  it("event is the `to` side → anchor is the `from` side", () => {
    const p = computeNeedsReviewPlacement(ev(2, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "low")], NOW);
    expect(p.anchorEventId).toBe(1);
  });

  it("same-thread none transition also yields low_context_slot", () => {
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "none")], NOW);
    expect(p.mode).toBe("low_context_slot");
    expect(p.anchorEventId).toBe(2);
  });

  it("populates ageHours even in low_context_slot mode", () => {
    // ended 1h before now
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "low")], NOW);
    expect(p.ageHours).toBe(1);
  });

  it("picks the first matching low-cost transition deterministically", () => {
    // event 1 in two low-cost transitions: (1,2) then (1,3); first wins → anchor 2
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "low"), tcost(1, 3, "none")], NOW);
    expect(p.anchorEventId).toBe(2);
  });

  it("ignores high/unknown transitions when choosing anchor", () => {
    // event 1 only in a high transition → no low-context anchor
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T21:00:00+09:00"), [tcost(1, 2, "high")], NOW);
    expect(p.mode).not.toBe("low_context_slot");
    expect(p.anchorEventId).toBeNull();
  });
});

describe("computeNeedsReviewPlacement — stale_due", () => {
  it("no low-context slot and age >= 12h → stale_due", () => {
    // ended 13h before now
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T09:00:00+09:00"), [], NOW);
    expect(p.mode).toBe("stale_due");
    expect(p.ageHours).toBe(13);
    expect(p.anchorEventId).toBeNull();
    expect(p.reasonCodes).toEqual(["placement_stale_due"]);
  });

  it("exactly 12h is stale", () => {
    // ended exactly 12h before now (10:00 → 22:00)
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T10:00:00+09:00"), [], NOW);
    expect(p.ageHours).toBe(12);
    expect(p.mode).toBe("stale_due");
  });

  it("high-cost transition with age >= 12h is stale (high is not low-context)", () => {
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T09:00:00+09:00"), [tcost(1, 2, "high")], NOW);
    expect(p.mode).toBe("stale_due");
  });
});

describe("computeNeedsReviewPlacement — no_context", () => {
  it("no low-context slot and age < 12h → no_context", () => {
    // ended 2h before now
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T20:00:00+09:00"), [], NOW);
    expect(p.mode).toBe("no_context");
    expect(p.ageHours).toBe(2);
    expect(p.reasonCodes).toEqual(["placement_no_context"]);
  });

  it("missing end → ageHours null and no_context (never stale)", () => {
    const p = computeNeedsReviewPlacement(ev(1, null), [], NOW);
    expect(p.ageHours).toBeNull();
    expect(p.mode).toBe("no_context");
  });

  it("invalid end string → ageHours null and no_context", () => {
    const p = computeNeedsReviewPlacement(ev(1, "not-a-date"), [], NOW);
    expect(p.ageHours).toBeNull();
    expect(p.mode).toBe("no_context");
  });

  it("future end clamps ageHours to 0, not negative", () => {
    // ends 1h after now
    const p = computeNeedsReviewPlacement(ev(1, "2026-06-20T23:00:00+09:00"), [], NOW);
    expect(p.ageHours).toBe(0);
    expect(p.mode).toBe("no_context");
  });
});
