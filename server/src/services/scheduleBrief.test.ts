import { describe, expect, it } from "vitest";
import type { AnnotationRow, EventRow, PersonRow, ThreadRow } from "@cairn/shared";
import { buildScheduleBrief, pickNewestAnnotation } from "./scheduleBrief.js";

function ev(over: Partial<EventRow> = {}): EventRow {
  return {
    id: 1, threadId: 10, title: "회의", type: null,
    start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
    location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned",
    createdAt: null, updatedAt: null, ...over
  };
}

function thread(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 10, name: "발표 준비", kind: null, goal: "데모", definitionOfDone: null,
    deadline: "2026-06-25", status: "active", createdAt: null, ...over
  } as ThreadRow;
}

function person(over: Partial<PersonRow> = {}): PersonRow {
  return { id: 5, name: "Alice", relation: "동료", channel: null, ...over };
}

function ann(over: Partial<AnnotationRow> = {}): AnnotationRow {
  return { id: 3, eventId: 9, outcome: "done", reasonTags: null, reasonText: "잘 됐어", energyAtTime: null, loggedAt: "2026-06-19T11:00:00+09:00", ...over };
}

describe("buildScheduleBrief — quiet", () => {
  it("null mode + no thread/prev/people → quiet brief with empty reasonCodes", () => {
    const b = buildScheduleBrief(ev({ mode: null, threadId: null }), null, null, null, []);
    expect(b.mode).toBeNull();
    expect(b.thread).toBeNull();
    expect(b.previousEvent).toBeNull();
    expect(b.previousAnnotation).toBeNull();
    expect(b.people).toEqual([]);
    expect(b.reasonCodes).toEqual([]);
  });
});

describe("buildScheduleBrief — facts and reasonCodes", () => {
  it("mode present adds brief_mode_present", () => {
    const b = buildScheduleBrief(ev({ mode: "remote" }), null, null, null, []);
    expect(b.mode).toBe("remote");
    expect(b.reasonCodes).toContain("brief_mode_present");
  });

  it("thread present → compact thread + reason", () => {
    const b = buildScheduleBrief(ev(), thread(), null, null, []);
    expect(b.thread).toEqual({ id: 10, name: "발표 준비", goal: "데모", deadline: "2026-06-25" });
    expect(b.reasonCodes).toContain("brief_thread_present");
  });

  it("previous event + annotation → compact previous + reasons", () => {
    const prev = ev({ id: 9, title: "리허설", start: "2026-06-19T09:00:00+09:00", end: "2026-06-19T10:00:00+09:00" });
    const b = buildScheduleBrief(ev(), thread(), prev, ann(), []);
    expect(b.previousEvent).toEqual({ id: 9, title: "리허설", start: "2026-06-19T09:00:00+09:00", end: "2026-06-19T10:00:00+09:00" });
    expect(b.previousAnnotation?.id).toBe(3);
    expect(b.reasonCodes).toContain("brief_previous_event");
    expect(b.reasonCodes).toContain("brief_previous_annotation");
  });

  it("people authored facts are surfaced factually (no advice)", () => {
    const p = person({
      preferredWindows: { weekdays: ["monday", "wednesday"], periods: ["evening"], firmness: "hard" },
      leadTime: { days: 3, firmness: "hard" },
      hardConstraints: [{ type: "weekday_unavailable", weekday: "friday", text: "금 불가", firmness: "hard" }]
    });
    const b = buildScheduleBrief(ev(), null, null, null, [p]);
    expect(b.people).toHaveLength(1);
    expect(b.people[0]).toEqual({
      personId: 5, name: "Alice", relation: "동료",
      preferredWeekdays: ["monday", "wednesday"], preferredPeriods: ["evening"],
      leadTimeDays: 3, unavailableWeekdays: ["friday"]
    });
    expect(b.reasonCodes).toContain("brief_people_present");
  });

  it("person with no authored profile yields empty fact arrays / null lead time", () => {
    const b = buildScheduleBrief(ev(), null, null, null, [person()]);
    expect(b.people[0]).toMatchObject({ preferredWeekdays: [], preferredPeriods: [], leadTimeDays: null, unavailableWeekdays: [] });
  });

  it("emits reasonCodes in fixed order", () => {
    const prev = ev({ id: 9, end: "2026-06-19T10:00:00+09:00" });
    const b = buildScheduleBrief(ev({ mode: "in_person" }), thread(), prev, ann(), [person()]);
    expect(b.reasonCodes).toEqual([
      "brief_mode_present", "brief_thread_present", "brief_previous_event",
      "brief_previous_annotation", "brief_people_present"
    ]);
  });
});

describe("pickNewestAnnotation", () => {
  it("returns null for empty", () => {
    expect(pickNewestAnnotation([])).toBeNull();
  });

  it("picks newest by loggedAt desc", () => {
    const older = ann({ id: 1, loggedAt: "2026-06-19T09:00:00+09:00" });
    const newer = ann({ id: 2, loggedAt: "2026-06-19T18:00:00+09:00" });
    expect(pickNewestAnnotation([older, newer])!.id).toBe(2);
  });

  it("tie-breaks by id desc on equal loggedAt", () => {
    const a = ann({ id: 1, loggedAt: "2026-06-19T09:00:00+09:00" });
    const b = ann({ id: 4, loggedAt: "2026-06-19T09:00:00+09:00" });
    expect(pickNewestAnnotation([a, b])!.id).toBe(4);
  });
});
