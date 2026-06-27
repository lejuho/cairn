import { describe, expect, it } from "vitest";
import {
  DismissSchedulePromptRequestSchema,
  EventRowSchema,
  PatchThreadEventNodeRequestSchema
} from "./events.js";

describe("PatchThreadEventNodeRequestSchema (cycle-50)", () => {
  it("accepts a single editable field", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({ title: "새 제목" }).success).toBe(true);
  });
  it("accepts all editable fields incl. null type/location and mode", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({ title: "x", type: null, location: null, mode: "remote" }).success).toBe(true);
  });
  it("accepts mode=null (unknown mode, not remote/async)", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({ mode: null }).success).toBe(true);
  });
  it("rejects an empty patch", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({}).success).toBe(false);
  });
  it("rejects a blank/whitespace title", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({ title: "   " }).success).toBe(false);
  });
  it("rejects an invalid mode", () => {
    expect(PatchThreadEventNodeRequestSchema.safeParse({ mode: "hybrid" }).success).toBe(false);
  });
  it("rejects unknown / non-editable fields (strict): start/end/status/threadId/source/firmness/score/autoApply", () => {
    for (const inj of [{ start: "2026-06-20T09:00:00+09:00" }, { end: "x" }, { status: "done" }, { threadId: 2 }, { source: "cairn" }, { firmness: "hard" }, { score: 1 }, { autoApply: true }]) {
      expect(PatchThreadEventNodeRequestSchema.safeParse({ title: "x", ...inj }).success).toBe(false);
    }
  });
});

describe("DismissSchedulePromptRequestSchema (cycle-61)", () => {
  it("accepts a valid YYYY-MM-DD dismissedOn", () => {
    expect(DismissSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-06-27" }).success).toBe(true);
  });
  it("rejects a missing field", () => {
    expect(DismissSchedulePromptRequestSchema.safeParse({}).success).toBe(false);
  });
  it("rejects a non-YYYY-MM-DD format", () => {
    expect(DismissSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026/06/27" }).success).toBe(false);
    expect(DismissSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-6-7" }).success).toBe(false);
  });
  it("rejects an overflow / non-real calendar date", () => {
    expect(DismissSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-02-30" }).success).toBe(false);
  });
  it("rejects injected fields (strict): score/autoApply/snoozedUntil/taskId", () => {
    for (const inj of [{ score: 1 }, { autoApply: true }, { snoozedUntil: "2026-06-28" }, { taskId: 5 }]) {
      expect(DismissSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-06-27", ...inj }).success).toBe(false);
    }
  });
});

describe("EventRowSchema — schedulePromptDismissedOn (cycle-61)", () => {
  const BASE = {
    id: 1, threadId: null, title: "산책", type: null, start: null, end: null,
    location: null, mode: null, source: "cairn" as const, selfImposed: 1,
    status: "planned" as const, createdAt: null, updatedAt: null
  };
  it("parses without the optional dismiss field (legacy rows)", () => {
    expect(EventRowSchema.safeParse(BASE).success).toBe(true);
  });
  it("parses with a dismiss date and with null", () => {
    expect(EventRowSchema.safeParse({ ...BASE, schedulePromptDismissedOn: "2026-06-27" }).success).toBe(true);
    expect(EventRowSchema.safeParse({ ...BASE, schedulePromptDismissedOn: null }).success).toBe(true);
  });
});
