import { describe, expect, it } from "vitest";
import { ItemListDataSchema, ItemListQuerySchema, ItemListResponseSchema } from "./items.js";

const EVENT = {
  id: 1,
  threadId: null,
  title: "병원 예약",
  type: null,
  start: null,
  end: null,
  location: null,
  mode: null,
  source: "cairn",
  selfImposed: 1,
  status: "planned",
  schedulePromptDismissedOn: null,
  createdAt: "2026-06-29T01:00:00+09:00",
  updatedAt: "2026-06-29T01:00:00+09:00"
};

const TASK = {
  id: 2,
  threadId: null,
  title: "서류 정리",
  estMinutes: null,
  due: null,
  context: null,
  status: "todo",
  optional: 0,
  schedulePromptDismissedOn: null,
  scheduledEventId: null,
  createdAt: "2026-06-29T01:01:00+09:00"
};

describe("Item list shared contract", () => {
  it("defaults query to active scope and a 100 row limit", () => {
    expect(ItemListQuerySchema.parse({})).toEqual({ scope: "active", limit: 100 });
  });

  it("accepts a valid item list payload", () => {
    expect(ItemListDataSchema.safeParse({ scope: "active", events: [EVENT], tasks: [TASK] }).success).toBe(true);
    expect(ItemListResponseSchema.safeParse({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }).success).toBe(true);
  });

  it("rejects out-of-range limits", () => {
    expect(ItemListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ItemListQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});
