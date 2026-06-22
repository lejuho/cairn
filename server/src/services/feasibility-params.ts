import type {
  FeasibilityParamLimits,
  FeasibilityParamSettingsData,
  UpdateFeasibilityParamsRequest
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { readNumericParam, upsertParam } from "../repositories/params.js";
import { DEFAULTS } from "./feasibility.js";

const LIMITS: FeasibilityParamLimits = {
  energyBudget:        { min: 1,    max: 16,  step: 0.5, unit: "h" },
  meetBufferMinutes:   { min: 0,    max: 120, step: 5,   unit: "min" },
  deepBufferMinutes:   { min: 0,    max: 180, step: 5,   unit: "min" },
  travelMargin:        { min: 0.5,  max: 3,   step: 0.1, unit: "x" },
  maxContinuousMinutes:{ min: 60,   max: 960, step: 30,  unit: "min" }
};

// DB snake_case key → camelCase field mapping.
const DB_KEYS = {
  energyBudget:        "energy_budget",
  meetBufferMinutes:   "meet_buffer",
  deepBufferMinutes:   "deep_buffer",
  travelMargin:        "travel_margin",
  maxContinuousMinutes:"max_continuous"
} as const;

export function readFeasibilityParamSettings(db: CairnDatabase): FeasibilityParamSettingsData {
  return {
    params: {
      energyBudget:        readNumericParam(db, DB_KEYS.energyBudget,        DEFAULTS.energyBudget),
      meetBufferMinutes:   readNumericParam(db, DB_KEYS.meetBufferMinutes,   DEFAULTS.meetBufferMinutes),
      deepBufferMinutes:   readNumericParam(db, DB_KEYS.deepBufferMinutes,   DEFAULTS.deepBufferMinutes),
      travelMargin:        readNumericParam(db, DB_KEYS.travelMargin,        DEFAULTS.travelMargin),
      maxContinuousMinutes:readNumericParam(db, DB_KEYS.maxContinuousMinutes,DEFAULTS.maxContinuousMinutes)
    },
    defaults: DEFAULTS,
    limits: LIMITS
  };
}

export function writeFeasibilityParams(db: CairnDatabase, input: UpdateFeasibilityParamsRequest): void {
  // Atomic: all five keys update or none do.
  db.transaction((tx) => {
    upsertParam(tx, DB_KEYS.energyBudget,        String(input.energyBudget));
    upsertParam(tx, DB_KEYS.meetBufferMinutes,   String(input.meetBufferMinutes));
    upsertParam(tx, DB_KEYS.deepBufferMinutes,   String(input.deepBufferMinutes));
    upsertParam(tx, DB_KEYS.travelMargin,        String(input.travelMargin));
    upsertParam(tx, DB_KEYS.maxContinuousMinutes,String(input.maxContinuousMinutes));
  });
}
