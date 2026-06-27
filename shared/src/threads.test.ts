import { describe, expect, it } from "vitest";
import {
  CreateThreadLinkRequestSchema,
  ThreadDetailSchema,
  ThreadNodeLinkSchema,
  ThreadUnknownBlockerSchema,
  ThreadSettlementSchema,
  ThreadMissingNodeSuggestionSchema,
  ThreadResumeDataSchema,
  PatchThreadResumeRequestSchema,
  ThreadResumeExportFormatSchema,
  ThreadResumeExportDataSchema,
  ThreadResumeExportQuerySchema,
  ConfirmThreadNodeLinkResponseDataSchema,
  ThreadLinkRowSchema,
  ThreadLinkViewSchema,
  ThreadRelationsSchema,
  ThreadRollupSchema,
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

const EMPTY_SETTLEMENT = {
  status: "not_ready" as const,
  paidCost: { eventCount: 0, money: 0, social: 0, effort: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 }, windowCount: 0 },
  avoidedMissing: { doneCount: 0, totalCount: 0, knownAvoidedCount: 0, unknownCostCount: 0, money: null, moneyStatus: "unavailable" as const },
  sampleStatus: "empty" as const,
  reasonCodes: ["settlement_not_done"]
};

const EMPTY_RESUME = {
  resumeRelevant: false, starSituation: null, starAction: null, starResult: null, skillsTags: []
};

// Zero decomposed paid cost — reused across rollup fixtures (cycle-60).
const ZERO_PC = { eventCount: 0, money: 0, social: 0, effort: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 }, windowCount: 0 };

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
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [],
        warnings: []
      },
      nodeLinks: [],
      unknownBlockers: [],
      settlement: EMPTY_SETTLEMENT,
      missingNodeSuggestions: [],
      resume: EMPTY_RESUME
    });
    expect(r.success).toBe(true);
  });

  it("rejects a detail missing resume", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW, events: [], tasks: [], progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [], warnings: []
      },
      nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT, missingNodeSuggestions: []
    });
    expect(r.success).toBe(false);
  });

  it("rejects a detail missing missingNodeSuggestions", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW, events: [], tasks: [], progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [], warnings: []
      },
      nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT
    });
    expect(r.success).toBe(false);
  });

  it("rejects a detail missing settlement", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [],
        warnings: []
      },
      nodeLinks: [],
      unknownBlockers: []
    });
    expect(r.success).toBe(false);
  });

  it("rejects a detail missing unknownBlockers", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [],
        warnings: []
      },
      nodeLinks: []
    });
    expect(r.success).toBe(false);
  });

  it("rejects a detail missing nodeLinks", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] },
      rollup: {
        direct: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC },
        contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        total: { progress: { done: 1, total: 5 }, energyHours: 2, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
        children: [],
        warnings: []
      }
    });
    expect(r.success).toBe(false);
  });

  it("rejects a detail missing rollup", () => {
    const r = ThreadDetailSchema.safeParse({
      thread: THREAD_ROW,
      events: [],
      tasks: [],
      progress: { done: 1, total: 5 },
      relations: { incoming: [VIEW], outgoing: [] }
    });
    expect(r.success).toBe(false);
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

const EMPTY_ROLLUP = {
  direct: { progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC },
  contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" as const },
  total: { progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" as const },
  children: [],
  warnings: []
};

describe("ThreadRollupSchema", () => {
  it("parses valid empty rollup (no children)", () => {
    expect(ThreadRollupSchema.safeParse(EMPTY_ROLLUP).success).toBe(true);
  });

  it("parses rollup with children and warnings", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      contains: { childCount: 1, descendantCount: 2, progress: { done: 3, total: 7 }, energyHours: 5.5, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
      total: { progress: { done: 4, total: 10 }, energyHours: 7.5, paidCost: ZERO_PC, missingCost: null, missingCostStatus: "unavailable" },
      children: [{ thread: { id: 2, name: "하위" }, depth: 1, relationId: 10, progress: { done: 3, total: 7 }, energyHours: 5.5, paidCost: ZERO_PC, descendantCount: 1 }],
      warnings: ["CONTAINS_CYCLE_DETECTED"]
    });
    expect(r.success).toBe(true);
  });

  it("parses decomposed paidCost on direct/contains/total/child", () => {
    const PC = { eventCount: 2, money: 5000, social: 1, effort: { none: 1, low: 0, medium: 1, high: 0, unknown: 0 }, windowCount: 1 };
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      direct: { progress: { done: 1, total: 2 }, energyHours: 1, paidCost: PC },
      contains: { childCount: 1, descendantCount: 1, progress: { done: 1, total: 1 }, energyHours: 1, paidCost: PC, missingCost: null, missingCostStatus: "unavailable" },
      total: { progress: { done: 2, total: 3 }, energyHours: 2, paidCost: PC, missingCost: null, missingCostStatus: "unavailable" },
      children: [{ thread: { id: 2, name: "하위" }, depth: 1, relationId: 10, progress: { done: 1, total: 1 }, energyHours: 1, paidCost: PC, descendantCount: 0 }]
    });
    expect(r.success).toBe(true);
  });

  it("rejects a rollup metric missing paidCost", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      direct: { progress: { done: 0, total: 0 }, energyHours: 0 }
    });
    expect(r.success).toBe(false);
  });

  it("rejects paidCost with an injected non-decomposed scalar field (strict)", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      direct: { progress: { done: 0, total: 0 }, energyHours: 0, paidCost: { ...ZERO_PC, score: 9 } }
    });
    expect(r.success).toBe(false);
  });

  it("rejects missingCostStatus other than unavailable", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      contains: { ...EMPTY_ROLLUP.contains, missingCostStatus: "available" }
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-null missingCost", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      contains: { ...EMPTY_ROLLUP.contains, missingCost: 42 }
    });
    expect(r.success).toBe(false);
  });

  it("rejects child with non-positive depth", () => {
    const r = ThreadRollupSchema.safeParse({
      ...EMPTY_ROLLUP,
      children: [{ thread: { id: 2, name: "하위" }, depth: 0, relationId: 10, progress: { done: 0, total: 0 }, energyHours: 0, paidCost: ZERO_PC, descendantCount: 0 }]
    });
    expect(r.success).toBe(false);
  });
});

describe("ThreadNodeLinkSchema (cycle-50)", () => {
  const LINK = {
    id: 5, kind: "requires", firmness: "soft", source: "inferred",
    from: { kind: "event", id: 1, title: "발표" },
    to: { kind: "task", id: 2, title: "슬라이드" }
  };
  it("accepts a valid node link with firmness/source evidence", () => {
    expect(ThreadNodeLinkSchema.safeParse(LINK).success).toBe(true);
  });
  it("accepts a hard/authored confirmed link", () => {
    expect(ThreadNodeLinkSchema.safeParse({ ...LINK, firmness: "hard", source: "authored" }).success).toBe(true);
  });
  it("rejects an invalid endpoint kind (strict)", () => {
    expect(ThreadNodeLinkSchema.safeParse({ ...LINK, from: { kind: "thread", id: 1, title: "x" } }).success).toBe(false);
  });
  it("rejects injected score/recommendation fields (strict)", () => {
    expect(ThreadNodeLinkSchema.safeParse({ ...LINK, score: 9 }).success).toBe(false);
    expect(ThreadNodeLinkSchema.safeParse({ ...LINK, recommendation: "x" }).success).toBe(false);
  });
  it("ConfirmThreadNodeLinkResponseData carries link + reused", () => {
    expect(ConfirmThreadNodeLinkResponseDataSchema.safeParse({ link: LINK, reused: true }).success).toBe(true);
    expect(ConfirmThreadNodeLinkResponseDataSchema.safeParse({ link: LINK }).success).toBe(false);
  });
});

describe("ThreadUnknownBlockerSchema (cycle-52)", () => {
  const BLOCKER = {
    id: "link:5:task.estMinutes",
    linkId: 5,
    linkKind: "requires",
    firmness: "soft",
    source: "inferred",
    prerequisite: { kind: "task", id: 2, title: "슬라이드 준비" },
    blockedNode: { kind: "event", id: 1, title: "발표" },
    missingField: "task.estMinutes",
    blockedField: "event.start",
    message: "‘슬라이드 준비’의 예상 시간이 없어 ‘발표’ 일정을 역산할 수 없어.",
    reasonCodes: ["blocker_missing_duration", "blocker_soft_link"]
  };
  it("accepts a valid blocker", () => {
    expect(ThreadUnknownBlockerSchema.safeParse(BLOCKER).success).toBe(true);
  });
  it("rejects an unknown missingField / blockedField enum", () => {
    expect(ThreadUnknownBlockerSchema.safeParse({ ...BLOCKER, missingField: "event.location" }).success).toBe(false);
    expect(ThreadUnknownBlockerSchema.safeParse({ ...BLOCKER, blockedField: "event.end" }).success).toBe(false);
  });
  it("rejects an unknown reasonCode", () => {
    expect(ThreadUnknownBlockerSchema.safeParse({ ...BLOCKER, reasonCodes: ["blocker_bogus"] }).success).toBe(false);
  });
  it("rejects injected score/recommendation/autoApply/suggestedStart/apply/confirmed fields (strict)", () => {
    for (const inj of [{ score: 1 }, { recommendation: "x" }, { advice: "y" }, { autoApply: true }, { suggestedStart: "2026-06-20T09:00:00+09:00" }, { apply: true }, { confirmed: true }]) {
      expect(ThreadUnknownBlockerSchema.safeParse({ ...BLOCKER, ...inj }).success).toBe(false);
    }
  });
});

describe("ThreadSettlementSchema (cycle-53)", () => {
  const READY = {
    status: "ready",
    paidCost: { eventCount: 2, money: 5000, social: 1, effort: { none: 1, low: 0, medium: 1, high: 0, unknown: 0 }, windowCount: 1 },
    avoidedMissing: { doneCount: 3, totalCount: 3, knownAvoidedCount: 3, unknownCostCount: 0, money: null, moneyStatus: "unavailable" },
    sampleStatus: "complete",
    reasonCodes: ["settlement_ready", "settlement_complete", "settlement_paid_cost_present", "settlement_avoided_money_unavailable"]
  };
  it("accepts a valid ready settlement", () => {
    expect(ThreadSettlementSchema.safeParse(READY).success).toBe(true);
  });
  it("accepts a valid not-ready empty settlement", () => {
    expect(ThreadSettlementSchema.safeParse({ ...READY, status: "not_ready", sampleStatus: "empty", reasonCodes: ["settlement_not_done"] }).success).toBe(true);
  });
  it("rejects avoidedMissing.money other than null", () => {
    expect(ThreadSettlementSchema.safeParse({ ...READY, avoidedMissing: { ...READY.avoidedMissing, money: 100 } }).success).toBe(false);
  });
  it("rejects moneyStatus other than unavailable", () => {
    expect(ThreadSettlementSchema.safeParse({ ...READY, avoidedMissing: { ...READY.avoidedMissing, moneyStatus: "available" } }).success).toBe(false);
  });
  it("rejects an unknown reasonCode / status / sampleStatus", () => {
    expect(ThreadSettlementSchema.safeParse({ ...READY, reasonCodes: ["bogus"] }).success).toBe(false);
    expect(ThreadSettlementSchema.safeParse({ ...READY, status: "done" }).success).toBe(false);
    expect(ThreadSettlementSchema.safeParse({ ...READY, sampleStatus: "half" }).success).toBe(false);
  });
  it("rejects injected score/recommendation/apply/estimatedMoney/suggestedAction fields (strict)", () => {
    for (const inj of [{ score: 1 }, { recommendation: "x" }, { advice: "y" }, { autoApply: true }, { apply: true }, { suggestedAction: "z" }, { estimatedMoney: 100 }]) {
      expect(ThreadSettlementSchema.safeParse({ ...READY, ...inj }).success).toBe(false);
    }
  });
});

describe("ThreadMissingNodeSuggestionSchema (cycle-54)", () => {
  const SUG = {
    id: "missing-node:event:비자 신청",
    nodeKind: "event",
    title: "비자 신청",
    firmness: "soft",
    source: "inferred",
    evidenceThreadCount: 2,
    evidenceNodeCount: 2,
    sampleThreads: [{ id: 3, name: "지난 여행" }, { id: 7, name: "출장" }],
    reasonCodes: ["missing_same_kind_completed_thread", "missing_absent_from_current_thread", "missing_repeated_evidence"]
  };
  it("accepts a valid suggestion", () => {
    expect(ThreadMissingNodeSuggestionSchema.safeParse(SUG).success).toBe(true);
  });
  it("rejects firmness/source other than soft/inferred", () => {
    expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, firmness: "hard" }).success).toBe(false);
    expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, source: "authored" }).success).toBe(false);
  });
  it("rejects an unknown reasonCode / nodeKind", () => {
    expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, reasonCodes: ["bogus"] }).success).toBe(false);
    expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, nodeKind: "thread" }).success).toBe(false);
  });
  it("rejects injected score/recommendation/apply/suggestedStart/suggestedDue/order/sequence/estimatedMoney fields (strict)", () => {
    for (const inj of [{ score: 1 }, { recommendation: "x" }, { advice: "y" }, { autoApply: true }, { apply: true }, { suggestedAction: "z" }, { estimatedMoney: 1 }, { suggestedStart: "2026-06-20T09:00:00+09:00" }, { suggestedDue: "2026-06-20" }, { order: 1 }, { sequence: 2 }]) {
      expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, ...inj }).success).toBe(false);
    }
  });
  it("rejects an injected field on a sampleThread (strict)", () => {
    expect(ThreadMissingNodeSuggestionSchema.safeParse({ ...SUG, sampleThreads: [{ id: 3, name: "x", score: 1 }] }).success).toBe(false);
  });
});

describe("ThreadResumeDataSchema / PatchThreadResumeRequestSchema (cycle-56)", () => {
  it("accepts default and full resume data", () => {
    expect(ThreadResumeDataSchema.safeParse({ resumeRelevant: false, starSituation: null, starAction: null, starResult: null, skillsTags: [] }).success).toBe(true);
    expect(ThreadResumeDataSchema.safeParse({ resumeRelevant: true, starSituation: "s", starAction: "a", starResult: "r", skillsTags: ["계획", "조율"] }).success).toBe(true);
  });
  it("PATCH accepts a single field and rejects an empty patch", () => {
    expect(PatchThreadResumeRequestSchema.safeParse({ resumeRelevant: true }).success).toBe(true);
    expect(PatchThreadResumeRequestSchema.safeParse({}).success).toBe(false);
  });
  it("PATCH accepts null text fields (clears) and skillsTags <=8", () => {
    expect(PatchThreadResumeRequestSchema.safeParse({ starSituation: null, skillsTags: [] }).success).toBe(true);
    expect(PatchThreadResumeRequestSchema.safeParse({ skillsTags: Array(8).fill("x") }).success).toBe(true);
  });
  it("PATCH trims skill items and rejects blank items / >8", () => {
    const r = PatchThreadResumeRequestSchema.safeParse({ skillsTags: ["  계획  ", "조율"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.skillsTags).toEqual(["계획", "조율"]);
    expect(PatchThreadResumeRequestSchema.safeParse({ skillsTags: ["ok", "   "] }).success).toBe(false);
    expect(PatchThreadResumeRequestSchema.safeParse({ skillsTags: Array(9).fill("x") }).success).toBe(false);
  });
  it("PATCH rejects injected task/starTask/score/recommendation/apply/exportPath/persist/saved/format fields (strict)", () => {
    for (const inj of [{ task: "x" }, { starTask: "x" }, { score: 1 }, { recommendation: "x" }, { advice: "y" }, { autoApply: true }, { apply: true }, { claim: "x" }, { exportPath: "/x" }, { persist: true }, { saved: true }, { format: "pdf" }]) {
      expect(PatchThreadResumeRequestSchema.safeParse({ resumeRelevant: true, ...inj }).success).toBe(false);
    }
  });
});

describe("ThreadResumeExport schemas (cycle-57)", () => {
  it("format accepts json/markdown and rejects others", () => {
    expect(ThreadResumeExportFormatSchema.safeParse("json").success).toBe(true);
    expect(ThreadResumeExportFormatSchema.safeParse("markdown").success).toBe(true);
    expect(ThreadResumeExportFormatSchema.safeParse("pdf").success).toBe(false);
    expect(ThreadResumeExportFormatSchema.safeParse("typst").success).toBe(false);
  });
  it("query requires a valid format and rejects extras", () => {
    expect(ThreadResumeExportQuerySchema.safeParse({ format: "json" }).success).toBe(true);
    expect(ThreadResumeExportQuerySchema.safeParse({}).success).toBe(false);
    expect(ThreadResumeExportQuerySchema.safeParse({ format: "json", download: true }).success).toBe(false);
  });
  it("export data accepts json payload with structured json and markdown without it", () => {
    const json = {
      format: "json" as const, content: "{}", warnings: [],
      json: { thread: { id: 1, name: "t", kind: null, goal: null, deadline: null }, star: { situation: "s", action: null, result: null }, skills: ["계획"] }
    };
    expect(ThreadResumeExportDataSchema.safeParse(json).success).toBe(true);
    expect(ThreadResumeExportDataSchema.safeParse({ format: "markdown", content: "# t", warnings: ["w"] }).success).toBe(true);
  });
  it("export data rejects injected download/score/apply/typst fields (strict)", () => {
    for (const inj of [{ download: "/x" }, { score: 1 }, { apply: true }, { typst: "x" }, { pcli: true }]) {
      expect(ThreadResumeExportDataSchema.safeParse({ format: "markdown", content: "x", warnings: [], ...inj }).success).toBe(false);
    }
  });
  it("enforces the format-specific json contract (json requires json; markdown rejects json)", () => {
    const struct = { thread: { id: 1, name: "t", kind: null, goal: null, deadline: null }, star: { situation: "s", action: null, result: null }, skills: [] };
    // json format MUST carry structured json
    expect(ThreadResumeExportDataSchema.safeParse({ format: "json", content: "{}", warnings: [] }).success).toBe(false);
    expect(ThreadResumeExportDataSchema.safeParse({ format: "json", content: "{}", warnings: [], json: struct }).success).toBe(true);
    // markdown format MUST NOT carry json
    expect(ThreadResumeExportDataSchema.safeParse({ format: "markdown", content: "# t", warnings: [], json: struct }).success).toBe(false);
    expect(ThreadResumeExportDataSchema.safeParse({ format: "markdown", content: "# t", warnings: [] }).success).toBe(true);
  });
});
