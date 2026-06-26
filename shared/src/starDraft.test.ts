import { describe, expect, it } from "vitest";
import {
  ThreadStarDraftSchema,
  ThreadStarDraftNarrativeSchema,
  ThreadStarDraftResponseDataSchema
} from "./starDraft.js";

const SETTLEMENT = {
  status: "ready" as const,
  paidCost: { eventCount: 1, money: 1000, social: 0, effort: { none: 0, low: 1, medium: 0, high: 0, unknown: 0 }, windowCount: 0 },
  avoidedMissing: { doneCount: 2, totalCount: 2, knownAvoidedCount: 2, unknownCostCount: 0, money: null, moneyStatus: "unavailable" as const },
  sampleStatus: "complete" as const,
  reasonCodes: ["settlement_ready"]
};

const DRAFT = {
  situation: "파리 여행을 준비했다.",
  task: "항공권과 숙소를 예약해야 했다.",
  action: "비교 후 예약을 마쳤다.",
  result: "일정대로 완료했다.",
  skills: ["계획", "조율"],
  confidence: "draft" as const,
  reasonCodes: ["star_from_completed_thread", "star_user_must_edit", "star_result_uses_settlement"]
};

describe("ThreadStarDraftSchema (cycle-55)", () => {
  it("accepts a valid draft", () => {
    expect(ThreadStarDraftSchema.safeParse(DRAFT).success).toBe(true);
  });
  it("rejects confidence other than 'draft'", () => {
    expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, confidence: "final" }).success).toBe(false);
  });
  it("rejects an unknown reasonCode", () => {
    expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, reasonCodes: ["bogus"] }).success).toBe(false);
  });
  it("rejects empty narrative fields and >8 skills", () => {
    expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, situation: "" }).success).toBe(false);
    expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, skills: Array(9).fill("s") }).success).toBe(false);
    expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, skills: ["ok", ""] }).success).toBe(false);
  });
  it("rejects injected score/recommendation/apply/exportPath/persist/saved fields (strict)", () => {
    for (const inj of [{ score: 1 }, { recommendation: "x" }, { advice: "y" }, { autoApply: true }, { apply: true }, { suggestedAction: "z" }, { estimatedMoney: 1 }, { exportPath: "/x" }, { persist: true }, { saved: true }, { exaggerated: true }, { claim: "x" }]) {
      expect(ThreadStarDraftSchema.safeParse({ ...DRAFT, ...inj }).success).toBe(false);
    }
  });
});

describe("ThreadStarDraftNarrativeSchema (cycle-55 LLM contract)", () => {
  it("accepts narrative fields only and rejects confidence/reasonCodes from the model", () => {
    const narrative = { situation: "s", task: "t", action: "a", result: "r", skills: ["x"] };
    expect(ThreadStarDraftNarrativeSchema.safeParse(narrative).success).toBe(true);
    expect(ThreadStarDraftNarrativeSchema.safeParse({ ...narrative, confidence: "draft" }).success).toBe(false);
    expect(ThreadStarDraftNarrativeSchema.safeParse({ ...narrative, reasonCodes: [] }).success).toBe(false);
  });
});

describe("ThreadStarDraftResponseDataSchema (cycle-55)", () => {
  it("accepts a draft + evidence envelope", () => {
    const data = {
      draft: DRAFT,
      evidence: {
        thread: { id: 1, name: "파리 여행", kind: "trip", goal: null, deadline: null },
        nodeTitles: ["항공권 예약", "숙소 예약"],
        annotationCount: 2,
        settlement: SETTLEMENT,
        warnings: ["목표가 비어 있어"]
      }
    };
    expect(ThreadStarDraftResponseDataSchema.safeParse(data).success).toBe(true);
  });
  it("rejects an injected top-level persist field (strict)", () => {
    const data = {
      draft: DRAFT,
      evidence: { thread: { id: 1, name: "x", kind: null, goal: null, deadline: null }, nodeTitles: [], annotationCount: 0, settlement: SETTLEMENT, warnings: [] },
      saved: true
    };
    expect(ThreadStarDraftResponseDataSchema.safeParse(data).success).toBe(false);
  });
});
