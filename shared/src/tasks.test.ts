import { describe, expect, it } from "vitest";
import { DismissTaskSchedulePromptRequestSchema, PatchThreadTaskNodeRequestSchema, TaskRowSchema } from "./tasks.js";

describe("PatchThreadTaskNodeRequestSchema (cycle-50)", () => {
  it("accepts a single editable field", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ optional: true }).success).toBe(true);
  });
  it("accepts all editable fields incl. nulls", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ title: "x", estMinutes: 30, due: "2026-06-20", context: null, optional: false }).success).toBe(true);
  });
  it("accepts null estMinutes/due/context", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ estMinutes: null, due: null, context: null }).success).toBe(true);
  });
  it("rejects an empty patch", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({}).success).toBe(false);
  });
  it("rejects a blank title", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ title: "  " }).success).toBe(false);
  });
  it("rejects a non-positive estMinutes", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ estMinutes: 0 }).success).toBe(false);
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ estMinutes: -5 }).success).toBe(false);
  });
  it("rejects an invalid / non-calendar due date", () => {
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ due: "2026-13-01" }).success).toBe(false);
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ due: "2026-6-1" }).success).toBe(false);
    expect(PatchThreadTaskNodeRequestSchema.safeParse({ due: "nope" }).success).toBe(false);
  });
  it("rejects unknown / non-editable fields (strict): status/threadId/score/autoApply", () => {
    for (const inj of [{ status: "done" }, { threadId: 2 }, { score: 1 }, { autoApply: true }]) {
      expect(PatchThreadTaskNodeRequestSchema.safeParse({ title: "x", ...inj }).success).toBe(false);
    }
  });
});

describe("DismissTaskSchedulePromptRequestSchema (cycle-62)", () => {
  it("accepts a valid YYYY-MM-DD dismissedOn", () => {
    expect(DismissTaskSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-06-27" }).success).toBe(true);
  });
  it("rejects missing / bad-format / overflow dates", () => {
    expect(DismissTaskSchedulePromptRequestSchema.safeParse({}).success).toBe(false);
    expect(DismissTaskSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026/06/27" }).success).toBe(false);
    expect(DismissTaskSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-02-30" }).success).toBe(false);
  });
  it("rejects injected fields (strict): score/autoApply/snoozedUntil/eventId", () => {
    for (const inj of [{ score: 1 }, { autoApply: true }, { snoozedUntil: "2026-06-28" }, { eventId: 5 }]) {
      expect(DismissTaskSchedulePromptRequestSchema.safeParse({ dismissedOn: "2026-06-27", ...inj }).success).toBe(false);
    }
  });
});

describe("TaskRowSchema — schedulePromptDismissedOn (cycle-62)", () => {
  const BASE = { id: 1, threadId: null, title: "보고서", estMinutes: 90, due: "2026-06-20", context: null, status: "todo" as const, optional: 0, createdAt: null };
  it("parses without the optional dismiss field (legacy rows)", () => {
    expect(TaskRowSchema.safeParse(BASE).success).toBe(true);
  });
  it("parses with a dismiss date and with null", () => {
    expect(TaskRowSchema.safeParse({ ...BASE, schedulePromptDismissedOn: "2026-06-19" }).success).toBe(true);
    expect(TaskRowSchema.safeParse({ ...BASE, schedulePromptDismissedOn: null }).success).toBe(true);
  });
  it("parses with scheduledEventId (number/null) and without it (cycle-63)", () => {
    expect(TaskRowSchema.safeParse(BASE).success).toBe(true);
    expect(TaskRowSchema.safeParse({ ...BASE, scheduledEventId: 42 }).success).toBe(true);
    expect(TaskRowSchema.safeParse({ ...BASE, scheduledEventId: null }).success).toBe(true);
  });
});
