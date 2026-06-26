import { describe, expect, it } from "vitest";
import {
  CreateThreadDraftRequestSchema,
  ThreadDraftParsedSchema
} from "./threadDraft.js";

describe("CreateThreadDraftRequestSchema (cycle-51)", () => {
  it("accepts a non-empty text", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "파리 여행 준비" }).success).toBe(true);
  });
  it("accepts now + timeZone", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", now: "2026-06-20T09:00:00+09:00", timeZone: "Asia/Seoul" }).success).toBe(true);
  });
  it("rejects blank / empty text", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });
  it("rejects text over 4000 chars", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "a".repeat(4001) }).success).toBe(false);
  });
  it("rejects unknown fields (strict)", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", autoApply: true }).success).toBe(false);
  });
  it("rejects an offsetless now", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", now: "2026-06-20T09:00:00" }).success).toBe(false);
  });
  it("accepts a valid IANA timeZone", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", timeZone: "America/New_York" }).success).toBe(true);
  });
  it("rejects a non-IANA timeZone string", () => {
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", timeZone: "not-a-zone" }).success).toBe(false);
    expect(CreateThreadDraftRequestSchema.safeParse({ text: "x", timeZone: "UTC+9" }).success).toBe(false);
  });
});

describe("ThreadDraftParsedSchema (cycle-51)", () => {
  const BASE = {
    thread: { name: "파리 여행", kind: "travel", goal: null, deadline: "2026-06-01" },
    events: [{ tempId: "e1", title: "항공권 예약", type: "travel", start: null, end: null, location: null, mode: null }],
    tasks: [{ tempId: "t1", title: "여권 확인", estMinutes: null, due: null, context: null, optional: false }],
    links: [{ from: { kind: "task", tempId: "t1" }, to: { kind: "event", tempId: "e1" }, kind: "requires" }],
    warnings: [{ code: "unknown_date", message: "날짜가 필요해" }]
  };

  it("accepts a valid draft with null unknown fields", () => {
    expect(ThreadDraftParsedSchema.safeParse(BASE).success).toBe(true);
  });
  it("accepts an empty-nodes draft (broad description)", () => {
    expect(ThreadDraftParsedSchema.safeParse({ thread: { name: "막연한 계획" }, events: [], tasks: [], links: [], warnings: [] }).success).toBe(true);
  });
  it("rejects an unknown event mode", () => {
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, events: [{ ...BASE.events[0], mode: "hybrid" }] }).success).toBe(false);
  });
  it("rejects an unknown link kind", () => {
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, links: [{ ...BASE.links[0], kind: "owns" }] }).success).toBe(false);
  });
  it("rejects an offsetless / placeholder event start", () => {
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, events: [{ ...BASE.events[0], start: "2026-06-20T09:00:00" }] }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, events: [{ ...BASE.events[0], start: "TBD" }] }).success).toBe(false);
  });
  it("rejects a placeholder / non-calendar deadline", () => {
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, thread: { ...BASE.thread, deadline: "?" } }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, thread: { ...BASE.thread, deadline: "2026-13-40" } }).success).toBe(false);
  });
  it("normalizes placeholder/empty unknown text fields to null (not stored as fact)", () => {
    const r = ThreadDraftParsedSchema.safeParse({
      ...BASE,
      thread: { name: "여행", kind: "TBD", goal: "  ", deadline: null },
      events: [{ ...BASE.events[0], type: "unknown", location: "?" }],
      tasks: [{ ...BASE.tasks[0], context: "미정" }]
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.thread.kind).toBeNull();
      expect(r.data.thread.goal).toBeNull();
      expect(r.data.events[0]!.type).toBeNull();
      expect(r.data.events[0]!.location).toBeNull();
      expect(r.data.tasks[0]!.context).toBeNull();
    }
  });
  it("keeps a real text value but trims it", () => {
    const r = ThreadDraftParsedSchema.safeParse({ ...BASE, thread: { name: "여행", kind: "  travel  ", goal: null, deadline: null } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.thread.kind).toBe("travel");
  });

  it("rejects injected score/recommendation/firmness/source/status/autoApply fields (strict)", () => {
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, score: 9 }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, links: [{ ...BASE.links[0], firmness: "hard" }] }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, links: [{ ...BASE.links[0], source: "authored" }] }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, events: [{ ...BASE.events[0], status: "confirmed" }] }).success).toBe(false);
    expect(ThreadDraftParsedSchema.safeParse({ ...BASE, tasks: [{ ...BASE.tasks[0], autoApply: true }] }).success).toBe(false);
  });
});
