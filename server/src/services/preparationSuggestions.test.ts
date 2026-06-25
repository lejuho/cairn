import { describe, expect, it } from "vitest";
import type { EventRow, ScheduleBriefPreparation, ThreadRow } from "@cairn/shared";
import { buildPreparationSuggestions } from "./preparationSuggestions.js";

function ev(title: string): EventRow {
  return {
    id: 1, threadId: 10, title, type: null,
    start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
    location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned",
    createdAt: null, updatedAt: null
  };
}

function thread(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 10, name: "스레드", kind: null, goal: null, definitionOfDone: null,
    deadline: null, status: "active", createdAt: null, ...over
  } as ThreadRow;
}

function prep(name: string): ScheduleBriefPreparation {
  return {
    resource: { id: 99, name, kind: "item", sourcePersonId: null, note: null, createdAt: null },
    sourcePerson: null,
    links: [{ targetType: "event", targetId: 1, scope: "event_direct", firmness: "hard", reason: null }],
    reasonCodes: ["prep_event_direct"]
  };
}

const FIXED = ["노트북", "충전기", "어댑터"];

describe("buildPreparationSuggestions — trigger matching", () => {
  it("event title keyword → three fixed items with reason + evidence", () => {
    const s = buildPreparationSuggestions(ev("발표 리허설"), null, []);
    expect(s.map((x) => x.name)).toEqual(FIXED);
    expect(s.every((x) => x.kind === "item" && x.source === "deterministic_keyword" && x.reasonCode === "presentation_keyword")).toBe(true);
    expect(s[0]!.reason).toBeTruthy();
    expect(s[0]!.evidence).toEqual({ field: "event_title", value: "발표 리허설" });
    expect(s[0]!.key).toBe("presentation:노트북");
  });

  it("thread name keyword triggers when event title does not", () => {
    const s = buildPreparationSuggestions(ev("주간 회의"), thread({ name: "데모 준비" }), []);
    expect(s.map((x) => x.name)).toEqual(FIXED);
    expect(s[0]!.evidence).toEqual({ field: "thread_name", value: "데모 준비" });
  });

  it("thread goal keyword triggers when title and name do not", () => {
    const s = buildPreparationSuggestions(ev("회의"), thread({ name: "프로젝트", goal: "세미나 발표" }), []);
    expect(s).toHaveLength(3);
    expect(s[0]!.evidence).toEqual({ field: "thread_goal", value: "세미나 발표" });
  });

  it("Latin keyword matches case-insensitively", () => {
    const s = buildPreparationSuggestions(ev("Quarterly DEMO"), null, []);
    expect(s).toHaveLength(3);
    expect(s[0]!.evidence.field).toBe("event_title");
  });

  it("unknown keywords return []", () => {
    expect(buildPreparationSuggestions(ev("점심 약속"), thread({ name: "개인", goal: "휴식" }), [])).toEqual([]);
  });

  it("no thread and non-matching title returns []", () => {
    expect(buildPreparationSuggestions(ev("산책"), null, [])).toEqual([]);
  });
});

describe("buildPreparationSuggestions — evidence selection (multiple matches)", () => {
  it("picks the first matching field in fixed order (event_title first)", () => {
    const s = buildPreparationSuggestions(ev("발표"), thread({ name: "데모", goal: "세미나" }), []);
    expect(s[0]!.evidence).toEqual({ field: "event_title", value: "발표" });
    // all items share the same evidence
    expect(new Set(s.map((x) => x.evidence.field))).toEqual(new Set(["event_title"]));
  });
});

describe("buildPreparationSuggestions — duplicate suppression", () => {
  it("suppresses an item already present in preparations (by name)", () => {
    const s = buildPreparationSuggestions(ev("발표"), null, [prep("노트북")]);
    expect(s.map((x) => x.name)).toEqual(["충전기", "어댑터"]);
  });

  it("suppresses an item linked via thread context (already visible in brief)", () => {
    // a prep present (e.g. thread_context) for 충전기 must hide that suggestion
    const s = buildPreparationSuggestions(ev("발표"), thread(), [prep("충전기")]);
    expect(s.map((x) => x.name)).toEqual(["노트북", "어댑터"]);
  });

  it("returns [] when all fixed items are already prepared", () => {
    const s = buildPreparationSuggestions(ev("발표"), null, [prep("노트북"), prep("충전기"), prep("어댑터")]);
    expect(s).toEqual([]);
  });
});

describe("buildPreparationSuggestions — stable ordering", () => {
  it("output is stable across repeated calls", () => {
    const a = buildPreparationSuggestions(ev("발표"), null, []);
    const b = buildPreparationSuggestions(ev("발표"), null, []);
    expect(a).toEqual(b);
    expect(a.map((x) => x.name)).toEqual(FIXED);
  });
});
