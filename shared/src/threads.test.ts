import { describe, expect, it } from "vitest";
import {
  CreateThreadLinkRequestSchema,
  ThreadDetailSchema,
  ThreadLinkRowSchema,
  ThreadLinkViewSchema,
  ThreadRelationsSchema,
  ThreadSummarySchema
} from "./threads.js";

const PEER_A = { id: 1, name: "상위 프로젝트" };
const PEER_B = { id: 2, name: "현재 스레드" };

const VIEW = {
  id: 10,
  fromThread: PEER_A,
  toThread: PEER_B,
  kind: "contains" as const,
  firmness: "hard" as const,
  createdAt: "2026-06-21T00:00:00"
};

const THREAD_ROW = {
  id: 1,
  name: "프로젝트 알파",
  kind: "project",
  goal: null,
  definitionOfDone: null,
  deadline: null,
  status: "active" as const,
  createdAt: null
};

describe("ThreadLinkRowSchema", () => {
  it("accepts a valid row", () => {
    const r = ThreadLinkRowSchema.safeParse({
      id: 5,
      fromThread: 1,
      toThread: 2,
      kind: "blocks",
      firmness: "soft",
      createdAt: null
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid firmness", () => {
    const r = ThreadLinkRowSchema.safeParse({
      id: 5,
      fromThread: 1,
      toThread: 2,
      kind: "blocks",
      firmness: "tentative",
      createdAt: null
    });
    expect(r.success).toBe(false);
  });
});

describe("ThreadLinkViewSchema", () => {
  it("accepts a valid view with peer objects", () => {
    expect(ThreadLinkViewSchema.safeParse(VIEW).success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    const r = ThreadLinkViewSchema.safeParse({ ...VIEW, kind: "owns" });
    expect(r.success).toBe(false);
  });

  it("rejects a peer missing its name", () => {
    const r = ThreadLinkViewSchema.safeParse({ ...VIEW, toThread: { id: 2 } });
    expect(r.success).toBe(false);
  });
});

describe("ThreadRelationsSchema", () => {
  it("accepts incoming/outgoing arrays of views", () => {
    const r = ThreadRelationsSchema.safeParse({ incoming: [VIEW], outgoing: [] });
    expect(r.success).toBe(true);
  });

  it("rejects when an array holds an invalid view", () => {
    const r = ThreadRelationsSchema.safeParse({ incoming: [{ ...VIEW, kind: "owns" }], outgoing: [] });
    expect(r.success).toBe(false);
  });
});

describe("CreateThreadLinkRequestSchema", () => {
  it("defaults firmness to hard when omitted", () => {
    const r = CreateThreadLinkRequestSchema.safeParse({ toThreadId: 2, kind: "contains" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.firmness).toBe("hard");
  });

  it("rejects a non-positive toThreadId", () => {
    expect(CreateThreadLinkRequestSchema.safeParse({ toThreadId: 0, kind: "contains" }).success).toBe(false);
    expect(CreateThreadLinkRequestSchema.safeParse({ toThreadId: -1, kind: "contains" }).success).toBe(false);
  });

  it("rejects a non-integer toThreadId", () => {
    expect(CreateThreadLinkRequestSchema.safeParse({ toThreadId: 1.5, kind: "contains" }).success).toBe(false);
  });

  it("rejects an invalid kind", () => {
    expect(CreateThreadLinkRequestSchema.safeParse({ toThreadId: 2, kind: "owns" }).success).toBe(false);
  });

  it("rejects an invalid firmness", () => {
    expect(CreateThreadLinkRequestSchema.safeParse({ toThreadId: 2, kind: "contains", firmness: "tentative" }).success).toBe(false);
  });
});

describe("ThreadSummarySchema.relationCounts", () => {
  it("accepts a summary carrying relation counts", () => {
    const r = ThreadSummarySchema.safeParse({
      thread: THREAD_ROW,
      eventCount: 2,
      taskCount: 3,
      doneCount: 1,
      totalCount: 5,
      relationCounts: { incoming: 1, outgoing: 2 }
    });
    expect(r.success).toBe(true);
  });

  it("rejects a summary missing relationCounts", () => {
    const r = ThreadSummarySchema.safeParse({
      thread: THREAD_ROW,
      eventCount: 2,
      taskCount: 3,
      doneCount: 1,
      totalCount: 5
    });
    expect(r.success).toBe(false);
  });
});

describe("ThreadDetailSchema.relations", () => {
  it("accepts a detail carrying relations", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] }
    });
    expect(r.success).toBe(true);
  });

  it("rejects a detail missing relations", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 }
    });
    expect(r.success).toBe(false);
  });
});
