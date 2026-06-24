import { describe, expect, it } from "vitest";
import {
  DayFeasibilitySchema,
  FeasibilityParamSettingsDataSchema,
  PreviewFeasibilityRequestSchema,
  SequenceEnergySchema,
  TransitionCostSchema,
  UpdateFeasibilityParamsRequestSchema
} from "./feasibility.js";

const VALID_PARAMS = {
  energyBudget: 8,
  meetBufferMinutes: 15,
  deepBufferMinutes: 30,
  travelMargin: 1,
  maxContinuousMinutes: 600
};

const VALID_LIMITS = {
  energyBudget: { min: 1, max: 16, step: 0.5, unit: "h" },
  meetBufferMinutes: { min: 0, max: 120, step: 5, unit: "min" },
  deepBufferMinutes: { min: 0, max: 180, step: 5, unit: "min" },
  travelMargin: { min: 0.5, max: 3, step: 0.1, unit: "x" },
  maxContinuousMinutes: { min: 60, max: 960, step: 30, unit: "min" }
};

describe("UpdateFeasibilityParamsRequestSchema", () => {
  it("accepts valid full replacement", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse(VALID_PARAMS).success).toBe(true);
  });

  it("rejects missing key", () => {
    const withoutEnergy = {
      meetBufferMinutes: VALID_PARAMS.meetBufferMinutes,
      deepBufferMinutes: VALID_PARAMS.deepBufferMinutes,
      travelMargin: VALID_PARAMS.travelMargin,
      maxContinuousMinutes: VALID_PARAMS.maxContinuousMinutes
    };
    expect(UpdateFeasibilityParamsRequestSchema.safeParse(withoutEnergy).success).toBe(false);
  });

  it("rejects energyBudget below min (1)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, energyBudget: 0 }).success).toBe(false);
  });

  it("rejects energyBudget above max (16)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, energyBudget: 17 }).success).toBe(false);
  });

  it("rejects meetBufferMinutes above max (120)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, meetBufferMinutes: 121 }).success).toBe(false);
  });

  it("rejects deepBufferMinutes above max (180)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, deepBufferMinutes: 181 }).success).toBe(false);
  });

  it("rejects travelMargin below min (0.5)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, travelMargin: 0.4 }).success).toBe(false);
  });

  it("rejects maxContinuousMinutes below min (60)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, maxContinuousMinutes: 59 }).success).toBe(false);
  });

  it("rejects NaN value", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, energyBudget: NaN }).success).toBe(false);
  });

  it("rejects Infinity value", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, travelMargin: Infinity }).success).toBe(false);
  });

  it("rejects injected score field (.strict)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, score: 99 }).success).toBe(false);
  });

  it("rejects injected recommendation field (.strict)", () => {
    expect(UpdateFeasibilityParamsRequestSchema.safeParse({ ...VALID_PARAMS, recommendation: "x" }).success).toBe(false);
  });
});

describe("FeasibilityParamSettingsDataSchema", () => {
  const VALID_SETTINGS = {
    params: VALID_PARAMS,
    defaults: VALID_PARAMS,
    limits: VALID_LIMITS
  };

  it("accepts valid settings data", () => {
    expect(FeasibilityParamSettingsDataSchema.safeParse(VALID_SETTINGS).success).toBe(true);
  });

  it("rejects injected unknown field (.strict)", () => {
    expect(FeasibilityParamSettingsDataSchema.safeParse({ ...VALID_SETTINGS, score: 1 }).success).toBe(false);
  });
});

describe("PreviewFeasibilityRequestSchema", () => {
  const VALID_PREVIEW = {
    date: "2026-06-22",
    now: "2026-06-22T09:00:00+09:00",
    params: VALID_PARAMS
  };

  it("accepts valid preview request", () => {
    expect(PreviewFeasibilityRequestSchema.safeParse(VALID_PREVIEW).success).toBe(true);
  });

  it("rejects invalid date format", () => {
    expect(PreviewFeasibilityRequestSchema.safeParse({ ...VALID_PREVIEW, date: "22-06-2026" }).success).toBe(false);
  });

  it("rejects non-RFC3339 now", () => {
    expect(PreviewFeasibilityRequestSchema.safeParse({ ...VALID_PREVIEW, now: "2026-06-22" }).success).toBe(false);
  });

  it("rejects out-of-range param in preview body", () => {
    expect(PreviewFeasibilityRequestSchema.safeParse({
      ...VALID_PREVIEW,
      params: { ...VALID_PARAMS, energyBudget: 0 }
    }).success).toBe(false);
  });
});

describe("TransitionCostSchema", () => {
  const VALID_TRANSITION = {
    fromEventId: 1,
    toEventId: 2,
    fromThreadId: 10,
    toThreadId: 20,
    relation: "context_link",
    relationKind: "feeds",
    firmness: "soft",
    costLevel: "low",
    reasonCodes: ["transition_context_link"]
  };

  it("accepts a full context_link/low transition", () => {
    expect(TransitionCostSchema.safeParse(VALID_TRANSITION).success).toBe(true);
  });

  it("accepts same_thread/none without relationKind/firmness", () => {
    expect(TransitionCostSchema.safeParse({
      fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: 10,
      relation: "same_thread", costLevel: "none", reasonCodes: ["transition_same_thread"]
    }).success).toBe(true);
  });

  it("accepts missing_thread/unknown with null thread ids", () => {
    expect(TransitionCostSchema.safeParse({
      fromEventId: 1, toEventId: 2, fromThreadId: null, toThreadId: 20,
      relation: "missing_thread", costLevel: "unknown", reasonCodes: ["transition_missing_thread"]
    }).success).toBe(true);
  });

  it("accepts unrelated/high and non_context_link/high", () => {
    expect(TransitionCostSchema.safeParse({
      fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: 20,
      relation: "unrelated", costLevel: "high", reasonCodes: ["transition_unrelated"]
    }).success).toBe(true);
    expect(TransitionCostSchema.safeParse({
      ...VALID_TRANSITION, relation: "non_context_link", relationKind: "blocks", firmness: "hard", costLevel: "high",
      reasonCodes: ["transition_non_context_link"]
    }).success).toBe(true);
  });

  it("rejects invalid relation", () => {
    expect(TransitionCostSchema.safeParse({ ...VALID_TRANSITION, relation: "maybe" }).success).toBe(false);
  });

  it("rejects invalid costLevel", () => {
    expect(TransitionCostSchema.safeParse({ ...VALID_TRANSITION, costLevel: "medium" }).success).toBe(false);
  });

  it("rejects injected score/recommendation/precision (strict)", () => {
    expect(TransitionCostSchema.safeParse({ ...VALID_TRANSITION, score: 9 }).success).toBe(false);
    expect(TransitionCostSchema.safeParse({ ...VALID_TRANSITION, recommendation: "reorder" }).success).toBe(false);
    expect(TransitionCostSchema.safeParse({ ...VALID_TRANSITION, costMinutes: 12.5 }).success).toBe(false);
  });
});

describe("DayFeasibilitySchema", () => {
  const VALID_DAY = {
    date: "2026-06-22",
    now: "2026-06-22T09:00:00+09:00",
    params: VALID_PARAMS,
    energy: { loadUnits: 2, budgetUnits: 8, remainingUnits: 6, deficit: false, confidence: "cold_start" },
    gaps: [],
    continuous: null,
    transitionCosts: [],
    sequenceEnergy: {
      workLoadUnits: 2, transitionLoadUnits: 0, totalLoadUnits: 2,
      budgetUnits: 8, remainingUnits: 6, deficit: false,
      unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"]
    }
  };

  it("accepts a day feasibility with transitionCosts and sequenceEnergy", () => {
    expect(DayFeasibilitySchema.safeParse(VALID_DAY).success).toBe(true);
  });

  it("requires transitionCosts", () => {
    const { transitionCosts, ...withoutTransitions } = VALID_DAY;
    void transitionCosts;
    expect(DayFeasibilitySchema.safeParse(withoutTransitions).success).toBe(false);
  });

  it("requires sequenceEnergy", () => {
    const { sequenceEnergy, ...withoutSequence } = VALID_DAY;
    void sequenceEnergy;
    expect(DayFeasibilitySchema.safeParse(withoutSequence).success).toBe(false);
  });
});

describe("SequenceEnergySchema", () => {
  const VALID_SEQ = {
    workLoadUnits: 4, transitionLoadUnits: 1, totalLoadUnits: 5,
    budgetUnits: 8, remainingUnits: 3, deficit: false,
    unknownTransitionCount: 1, confidence: "cold_start", reasonCodes: ["sequence_transition_added"]
  };

  it("accepts valid cold-start sequence energy", () => {
    expect(SequenceEnergySchema.safeParse(VALID_SEQ).success).toBe(true);
  });

  it("rejects non-cold_start confidence", () => {
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, confidence: "calibrated" }).success).toBe(false);
  });

  it("rejects negative unknownTransitionCount", () => {
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, unknownTransitionCount: -1 }).success).toBe(false);
  });

  it("rejects injected recommendation/advice/action/reorder (strict)", () => {
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, recommendation: "reorder" }).success).toBe(false);
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, advice: "move" }).success).toBe(false);
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, action: "optimize" }).success).toBe(false);
    expect(SequenceEnergySchema.safeParse({ ...VALID_SEQ, reorder: true }).success).toBe(false);
  });
});
