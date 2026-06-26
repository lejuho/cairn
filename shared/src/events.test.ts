import { describe, expect, it } from "vitest";
import { PatchThreadEventNodeRequestSchema } from "./events.js";

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
