import { describe, expect, it } from "vitest";
import {
  FeasibilityParamSettingsDataSchema,
  PreviewFeasibilityRequestSchema,
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
