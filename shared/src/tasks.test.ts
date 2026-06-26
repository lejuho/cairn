import { describe, expect, it } from "vitest";
import { PatchThreadTaskNodeRequestSchema } from "./tasks.js";

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
