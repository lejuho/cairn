import { describe, expect, it } from "vitest";
import { CreateEventRequestSchema, EventModeSchema, EventRowSchema } from "./events.js";
import { EventDetailDataSchema, ScheduleBriefSchema } from "./eventDetail.js";

const BASE_EVENT = {
  id: 1, threadId: null, title: "회의", type: null,
  start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
  location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned",
  createdAt: null, updatedAt: null
};

describe("EventModeSchema", () => {
  it.each(["in_person", "remote", "async"])("accepts %s", (m) => {
    expect(EventModeSchema.safeParse(m).success).toBe(true);
  });
  it("rejects unknown mode", () => {
    expect(EventModeSchema.safeParse("hybrid").success).toBe(false);
  });
});

describe("CreateEventRequestSchema mode", () => {
  const base = { title: "T", start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00" };
  it("accepts request without mode", () => {
    expect(CreateEventRequestSchema.safeParse(base).success).toBe(true);
  });
  it("accepts request with valid mode", () => {
    expect(CreateEventRequestSchema.safeParse({ ...base, mode: "remote" }).success).toBe(true);
  });
  it("rejects invalid mode", () => {
    expect(CreateEventRequestSchema.safeParse({ ...base, mode: "hybrid" }).success).toBe(false);
  });
});

describe("EventRowSchema mode", () => {
  it("requires mode (nullable)", () => {
    const { mode, ...withoutMode } = BASE_EVENT;
    void mode;
    expect(EventRowSchema.safeParse(withoutMode).success).toBe(false);
  });
  it("accepts null mode (legacy rows)", () => {
    expect(EventRowSchema.safeParse({ ...BASE_EVENT, mode: null }).success).toBe(true);
  });
  it("accepts a set mode", () => {
    expect(EventRowSchema.safeParse({ ...BASE_EVENT, mode: "in_person" }).success).toBe(true);
  });
});

describe("ScheduleBriefSchema", () => {
  const QUIET = { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], reasonCodes: [] };

  it("accepts a quiet brief (all null/empty)", () => {
    expect(ScheduleBriefSchema.safeParse(QUIET).success).toBe(true);
  });

  it("accepts a full brief", () => {
    const full = {
      mode: "in_person",
      thread: { id: 1, name: "발표 준비", goal: "데모", deadline: "2026-06-25" },
      previousEvent: { id: 9, title: "리허설", start: "2026-06-19T09:00:00+09:00", end: "2026-06-19T10:00:00+09:00" },
      previousAnnotation: { id: 3, eventId: 9, outcome: "done", reasonTags: null, reasonText: "잘 됐어", energyAtTime: null, loggedAt: "2026-06-19T11:00:00+09:00" },
      people: [{ personId: 5, name: "Alice", relation: "동료", preferredWeekdays: ["monday"], preferredPeriods: ["evening"], leadTimeDays: 3, unavailableWeekdays: ["friday"] }],
      reasonCodes: ["brief_mode_present", "brief_thread_present", "brief_previous_event", "brief_previous_annotation", "brief_people_present"]
    };
    expect(ScheduleBriefSchema.safeParse(full).success).toBe(true);
  });

  it("rejects injected movement/procurement/domain fields (strict)", () => {
    expect(ScheduleBriefSchema.safeParse({ ...QUIET, travelOption: "bus" }).success).toBe(false);
    expect(ScheduleBriefSchema.safeParse({ ...QUIET, procurement: {} }).success).toBe(false);
    expect(ScheduleBriefSchema.safeParse({ ...QUIET, vendor: "X" }).success).toBe(false);
    expect(ScheduleBriefSchema.safeParse({ ...QUIET, recommendation: "go early" }).success).toBe(false);
  });

  it("rejects advice/inferred fields on people brief (strict)", () => {
    const withAdvice = {
      ...QUIET,
      people: [{ personId: 5, name: "Alice", relation: null, preferredWeekdays: [], preferredPeriods: [], leadTimeDays: null, unavailableWeekdays: [], advice: "be gentle" }]
    };
    expect(ScheduleBriefSchema.safeParse(withAdvice).success).toBe(false);
  });
});

describe("EventDetailDataSchema scheduleBrief", () => {
  const base = {
    event: BASE_EVENT, people: [], annotations: [], thread: null,
    scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], reasonCodes: [] }
  };
  it("accepts detail with scheduleBrief", () => {
    expect(EventDetailDataSchema.safeParse(base).success).toBe(true);
  });
  it("requires scheduleBrief", () => {
    const { scheduleBrief, ...without } = base;
    void scheduleBrief;
    expect(EventDetailDataSchema.safeParse(without).success).toBe(false);
  });
});
