import { describe, expect, it } from "vitest";
import { WatcherABubbleSchema } from "./watchers.js";

const VALID_BUBBLE = {
  id: 1,
  label: "여권 갱신",
  category: "procurement",
  kind: "A" as const,
  threshold: "2026-06-22",
  snoozedUntil: null,
  daysOverdue: 0,
  reasonCodes: ["date_threshold_due" as const],
  message: "오늘 확인할 watcher야"
};

describe("WatcherABubbleSchema", () => {
  it("parses a valid bubble", () => {
    const result = WatcherABubbleSchema.safeParse(VALID_BUBBLE);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, score: 99 });
    expect(result.success).toBe(false);
  });

  it("rejects advice/recommendation fields", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, recommendation: "구매해" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid reason code", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, reasonCodes: ["unknown_code"] });
    expect(result.success).toBe(false);
  });

  it("requires kind to be A", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, kind: "B" });
    expect(result.success).toBe(false);
  });

  it("rejects negative daysOverdue", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, daysOverdue: -1 });
    expect(result.success).toBe(false);
  });

  it("allows daysOverdue > 0 for overdue watchers", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, daysOverdue: 5 });
    expect(result.success).toBe(true);
  });

  it("allows null label", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, label: null });
    expect(result.success).toBe(true);
  });

  it("allows non-null snoozedUntil", () => {
    const result = WatcherABubbleSchema.safeParse({
      ...VALID_BUBBLE,
      snoozedUntil: "2026-06-30T00:00:00+09:00"
    });
    expect(result.success).toBe(true);
  });
});
