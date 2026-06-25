import { describe, expect, it } from "vitest";
import type { EventRow } from "@cairn/shared";
import { buildMirrorTransitionFriction } from "./mirror-transition-friction.js";
import type { ThreadLinkRow } from "./context-switch.js";
import type { FrictionAnnotationRow } from "../repositories/mirror.js";

const TODAY = "2026-06-22";
const NO_LINKS: ThreadLinkRow[] = [];
const NO_ANN: FrictionAnnotationRow[] = [];

// Event on `date` at `hour`, in thread `threadId` (null = no thread).
function ev(id: number, date: string, hour: number, threadId: number | null = id): EventRow {
  const h = String(hour).padStart(2, "0");
  return {
    id, threadId, title: `E${id}`, type: null,
    start: `${date}T${h}:00:00+09:00`, end: `${date}T${h}:50:00+09:00`,
    location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned",
    createdAt: null, updatedAt: null
  };
}

function link(fromThread: number, toThread: number, kind: ThreadLinkRow["kind"], firmness: ThreadLinkRow["firmness"] = "soft"): ThreadLinkRow {
  return { id: fromThread * 1000 + toThread, fromThread, toThread, kind, firmness };
}

function ann(loggedAt: string, outcome: string | null, energyAtTime: number | null = null): FrictionAnnotationRow {
  return { outcome, energyAtTime, loggedAt };
}

describe("buildMirrorTransitionFriction — empty / quiet", () => {
  it("empty range returns quiet, low-sample data with default 31-day window", () => {
    const d = buildMirrorTransitionFriction([], NO_LINKS, NO_ANN, { today: TODAY });
    expect(d.range).toEqual({ from: "2026-05-23", to: TODAY });
    expect(d.summary.days).toBe(31);
    expect(d.summary.activeDays).toBe(0);
    expect(d.summary.totalTransitionPairs).toBe(0);
    expect(d.summary.sampleStatus).toBe("low_sample");
    expect(d.days).toEqual([]);
  });

  it("single-event day has zero transition pairs and is low_sample", () => {
    const d = buildMirrorTransitionFriction([ev(1, "2026-06-20", 9)], NO_LINKS, NO_ANN, { today: TODAY });
    expect(d.days).toHaveLength(1);
    expect(d.days[0]!.transitionPairs).toBe(0);
    expect(d.days[0]!.sampleStatus).toBe("low_sample");
    expect(d.days[0]!.reasonCodes).toContain("friction_no_transitions");
    expect(d.summary.lowSampleDays).toBe(1);
  });
});

describe("buildMirrorTransitionFriction — classification (reuses computeTransitionCosts)", () => {
  it("same-thread consecutive events classify as same/none", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 10)],
      NO_LINKS, NO_ANN, { today: TODAY }
    );
    const day = d.days[0]!;
    expect(day.transitionPairs).toBe(1);
    expect(day.sameThreadPairs).toBe(1);
    expect(day.lowTransitionPairs).toBe(0);
    expect(day.highTransitionPairs).toBe(0);
  });

  it("context-link pair classifies as low", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 20)],
      [link(10, 20, "contains")], NO_ANN, { today: TODAY }
    );
    const day = d.days[0]!;
    expect(day.contextPairs).toBe(1);
    expect(day.lowTransitionPairs).toBe(1);
  });

  it("non-context/unrelated pair classifies as high", () => {
    const unrelated = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 20)],
      NO_LINKS, NO_ANN, { today: TODAY }
    ).days[0]!;
    expect(unrelated.unrelatedPairs).toBe(1);
    expect(unrelated.highTransitionPairs).toBe(1);
    expect(unrelated.reasonCodes).toContain("friction_high_present");

    const nonContext = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 20)],
      [link(10, 20, "blocks")], NO_ANN, { today: TODAY }
    ).days[0]!;
    expect(nonContext.unrelatedPairs).toBe(1); // non_context_link folds into unrelatedPairs
    expect(nonContext.highTransitionPairs).toBe(1);
  });

  it("missing thread id pair classifies as unknown without guessing", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, null), ev(2, "2026-06-20", 10, 20)],
      NO_LINKS, NO_ANN, { today: TODAY }
    );
    const day = d.days[0]!;
    expect(day.missingThreadPairs).toBe(1);
    expect(day.unknownTransitionPairs).toBe(1);
    expect(day.highTransitionPairs).toBe(0); // not treated as high friction
    expect(day.reasonCodes).toContain("friction_unknown_present");
  });
});

describe("buildMirrorTransitionFriction — ordering + aggregation", () => {
  it("multi-day output is newest-first", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-18", 9, 1), ev(2, "2026-06-18", 10, 1), ev(3, "2026-06-20", 9, 1), ev(4, "2026-06-20", 10, 1)],
      NO_LINKS, NO_ANN, { today: TODAY }
    );
    expect(d.days.map((x) => x.date)).toEqual(["2026-06-20", "2026-06-18"]);
    expect(d.summary.activeDays).toBe(2);
    expect(d.summary.totalTransitionPairs).toBe(2);
  });

  it("equal-start events keep stable pair counts (relies on read's id asc)", () => {
    // two events at the same start; the read orders by id asc, so pairing is stable.
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 9, 20)],
      NO_LINKS, NO_ANN, { today: TODAY }
    );
    expect(d.days[0]!.transitionPairs).toBe(1);
  });

  it("aggregates annotation outcomes and energy averages by logged date", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 20)],
      NO_LINKS,
      [
        ann("2026-06-20T11:00:00+09:00", "done", 4),
        ann("2026-06-20T12:00:00+09:00", "cancelled", 2),
        ann("2026-06-20T13:00:00+09:00", null, null) // no outcome/energy
      ],
      { today: TODAY }
    );
    const day = d.days[0]!;
    expect(day.outcomes).toEqual({ done: 1, moved: 0, cancelled: 1, late: 0 });
    expect(day.energy.entryCount).toBe(2);
    expect(day.energy.averageEnergyAtTime).toBe(3); // (4+2)/2
  });

  it("no energy entries yields null average, zero entryCount", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-20", 9, 10), ev(2, "2026-06-20", 10, 20)],
      NO_LINKS, [ann("2026-06-20T11:00:00+09:00", "moved", null)], { today: TODAY }
    );
    expect(d.days[0]!.energy).toEqual({ entryCount: 0, averageEnergyAtTime: null });
    expect(d.days[0]!.outcomes.moved).toBe(1);
  });
});

describe("buildMirrorTransitionFriction — sample status", () => {
  it("overall low_sample when active days < 3, ok when >= 3", () => {
    const mk = (date: string) => [ev(date.length, date, 9, 1), ev(date.length + 100, date, 10, 1)];
    const two = buildMirrorTransitionFriction([...mk("2026-06-18"), ...mk("2026-06-19")], NO_LINKS, NO_ANN, { today: TODAY });
    expect(two.summary.sampleStatus).toBe("low_sample");

    const e = (id: number, date: string, hour: number) => ev(id, date, hour, 1);
    const three = buildMirrorTransitionFriction(
      [e(1, "2026-06-18", 9), e(2, "2026-06-18", 10), e(3, "2026-06-19", 9), e(4, "2026-06-19", 10), e(5, "2026-06-20", 9), e(6, "2026-06-20", 10)],
      NO_LINKS, NO_ANN, { today: TODAY }
    );
    expect(three.summary.activeDays).toBe(3);
    expect(three.summary.sampleStatus).toBe("ok");
  });

  it("excludes events outside the explicit range", () => {
    const d = buildMirrorTransitionFriction(
      [ev(1, "2026-06-10", 9, 1), ev(2, "2026-06-20", 9, 1), ev(3, "2026-06-20", 10, 1)],
      NO_LINKS, NO_ANN, { from: "2026-06-19", to: "2026-06-21", today: TODAY }
    );
    expect(d.days.map((x) => x.date)).toEqual(["2026-06-20"]);
    expect(d.range).toEqual({ from: "2026-06-19", to: "2026-06-21" });
    expect(d.summary.days).toBe(3);
  });
});
