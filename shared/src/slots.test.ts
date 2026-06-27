import { describe, expect, it } from "vitest";
import {
  ScheduleTaskBlockRequestSchema,
  ScheduleTaskBlockResponseDataSchema,
  SlotCandidateSchema,
  SlotSuggestionContributionSchema,
  SlotSuggestionLensSchema,
  SlotSuggestionImpactSchema,
  SlotSuggestionConfidenceSchema,
  TaskSlotCandidatesResponseDataSchema
} from "./slots.js";

const BASE_CONTRIBUTION = {
  lens: "availability",
  label: "겹침",
  impact: "positive",
  points: 40,
  confidence: "observed",
  reasonCodes: ["free_window"],
  evidence: ["2026-06-23 09:00–10:00 사이 겹치는 일정 없음"]
};

const BASE_CANDIDATE = {
  start: "2026-06-23T09:00:00+09:00",
  end: "2026-06-23T10:00:00+09:00",
  score: 82,
  rank: 1,
  scoreLabel: "좋음",
  reasons: ["겹치는 일정 없음"],
  reasonCodes: ["free_window"],
  contributions: [BASE_CONTRIBUTION]
};

describe("SlotSuggestionLensSchema", () => {
  it("accepts all four lens values", () => {
    for (const lens of ["availability", "feasibility", "people", "friction"] as const) {
      expect(SlotSuggestionLensSchema.parse(lens)).toBe(lens);
    }
  });

  it("rejects unknown lens", () => {
    expect(SlotSuggestionLensSchema.safeParse("cost").success).toBe(false);
  });
});

describe("SlotSuggestionImpactSchema", () => {
  it("accepts positive, neutral, negative", () => {
    for (const v of ["positive", "neutral", "negative"] as const) {
      expect(SlotSuggestionImpactSchema.parse(v)).toBe(v);
    }
  });
});

describe("SlotSuggestionConfidenceSchema", () => {
  it("accepts observed, cold_start, unavailable", () => {
    for (const v of ["observed", "cold_start", "unavailable"] as const) {
      expect(SlotSuggestionConfidenceSchema.parse(v)).toBe(v);
    }
  });
});

describe("SlotSuggestionContributionSchema", () => {
  it("parses valid contribution", () => {
    const result = SlotSuggestionContributionSchema.parse(BASE_CONTRIBUTION);
    expect(result.lens).toBe("availability");
    expect(result.points).toBe(40);
  });

  it("rejects unknown fields (strict)", () => {
    const r = SlotSuggestionContributionSchema.safeParse({ ...BASE_CONTRIBUTION, recommendation: "do it" });
    expect(r.success).toBe(false);
  });

  it("rejects contribution missing lens", () => {
    const rest = { label: BASE_CONTRIBUTION.label, impact: BASE_CONTRIBUTION.impact, points: BASE_CONTRIBUTION.points, confidence: BASE_CONTRIBUTION.confidence, reasonCodes: BASE_CONTRIBUTION.reasonCodes, evidence: BASE_CONTRIBUTION.evidence };
    expect(SlotSuggestionContributionSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts personIds as optional field without breaking strict rejection", () => {
    const withPersonIds = { ...BASE_CONTRIBUTION, personIds: [42] };
    expect(SlotSuggestionContributionSchema.parse(withPersonIds).personIds).toEqual([42]);
    // personIds absent is still valid
    expect(SlotSuggestionContributionSchema.parse(BASE_CONTRIBUTION).personIds).toBeUndefined();
    // unknown field still rejected even when personIds present
    expect(SlotSuggestionContributionSchema.safeParse({ ...withPersonIds, advice: "x" }).success).toBe(false);
  });
});

describe("SlotCandidateSchema", () => {
  it("parses valid enriched candidate", () => {
    const result = SlotCandidateSchema.parse(BASE_CANDIDATE);
    expect(result.score).toBe(82);
    expect(result.rank).toBe(1);
    expect(result.scoreLabel).toBe("좋음");
    expect(result.contributions).toHaveLength(1);
  });

  it("rejects candidate missing score", () => {
    const rest = { start: BASE_CANDIDATE.start, end: BASE_CANDIDATE.end, rank: BASE_CANDIDATE.rank, scoreLabel: BASE_CANDIDATE.scoreLabel, reasons: BASE_CANDIDATE.reasons, reasonCodes: BASE_CANDIDATE.reasonCodes, contributions: BASE_CANDIDATE.contributions };
    expect(SlotCandidateSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects candidate missing rank", () => {
    const rest = { start: BASE_CANDIDATE.start, end: BASE_CANDIDATE.end, score: BASE_CANDIDATE.score, scoreLabel: BASE_CANDIDATE.scoreLabel, reasons: BASE_CANDIDATE.reasons, reasonCodes: BASE_CANDIDATE.reasonCodes, contributions: BASE_CANDIDATE.contributions };
    expect(SlotCandidateSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects candidate missing contributions", () => {
    const rest = { start: BASE_CANDIDATE.start, end: BASE_CANDIDATE.end, score: BASE_CANDIDATE.score, rank: BASE_CANDIDATE.rank, scoreLabel: BASE_CANDIDATE.scoreLabel, reasons: BASE_CANDIDATE.reasons, reasonCodes: BASE_CANDIDATE.reasonCodes };
    expect(SlotCandidateSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects unknown fields such as recommendation, advice, mutation flags (strict)", () => {
    expect(SlotCandidateSchema.safeParse({ ...BASE_CANDIDATE, recommendation: "book it" }).success).toBe(false);
    expect(SlotCandidateSchema.safeParse({ ...BASE_CANDIDATE, advice: "go early" }).success).toBe(false);
    expect(SlotCandidateSchema.safeParse({ ...BASE_CANDIDATE, autoSchedule: true }).success).toBe(false);
  });

  it("TaskSlotCandidatesResponseDataSchema reuses task + strict SlotCandidate (cycle-62)", () => {
    const TASK = { id: 7, threadId: null, title: "보고서", estMinutes: 90, due: "2026-06-20", context: null, status: "todo", optional: 0, createdAt: null };
    expect(TaskSlotCandidatesResponseDataSchema.safeParse({ task: TASK, candidates: [BASE_CANDIDATE] }).success).toBe(true);
    // a candidate with an injected mutation flag is rejected by the strict inner schema
    expect(TaskSlotCandidatesResponseDataSchema.safeParse({ task: TASK, candidates: [{ ...BASE_CANDIDATE, autoSchedule: true }] }).success).toBe(false);
  });

  it("accepts multiple contributions with different lenses", () => {
    const candidate = {
      ...BASE_CANDIDATE,
      contributions: [
        BASE_CONTRIBUTION,
        { lens: "feasibility", label: "체력", impact: "positive", points: 25, confidence: "observed", reasonCodes: ["energy_within_budget"], evidence: ["load 3h / budget 8h"] },
        { lens: "people", label: "참여자", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["people_no_data"], evidence: ["연결된 사람 없음"] },
        { lens: "friction", label: "마찰", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["friction_low_sample"], evidence: ["과거 표본 부족"] }
      ]
    };
    expect(SlotCandidateSchema.parse(candidate).contributions).toHaveLength(4);
  });
});

describe("ScheduleTaskBlockRequestSchema (cycle-63)", () => {
  const VALID = { date: "2026-06-27", now: "2026-06-27T09:00:00+09:00", days: 7, start: "2026-06-28T14:00:00+09:00", end: "2026-06-28T15:30:00+09:00" };
  it("parses a valid apply request", () => {
    expect(ScheduleTaskBlockRequestSchema.safeParse(VALID).success).toBe(true);
  });
  it("defaults days to 7 when omitted", () => {
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.days;
    const r = ScheduleTaskBlockRequestSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.days).toBe(7);
  });
  it("rejects end before/equal start", () => {
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, end: VALID.start }).success).toBe(false);
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, start: VALID.end, end: VALID.start }).success).toBe(false);
  });
  it("rejects malformed date/now and out-of-range days", () => {
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, date: "2026/06/27" }).success).toBe(false);
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, now: "not-a-time" }).success).toBe(false);
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, days: 0 }).success).toBe(false);
    expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, days: 15 }).success).toBe(false);
  });
  it("rejects missing required fields", () => {
    for (const k of ["date", "now", "start", "end"] as const) {
      const rest: Record<string, unknown> = { ...VALID };
      delete rest[k];
      expect(ScheduleTaskBlockRequestSchema.safeParse(rest).success).toBe(false);
    }
  });
  it("rejects injected fields (strict): score/apply/taskId/autoApply", () => {
    for (const inj of [{ score: 1 }, { apply: true }, { taskId: 5 }, { autoApply: true }]) {
      expect(ScheduleTaskBlockRequestSchema.safeParse({ ...VALID, ...inj }).success).toBe(false);
    }
  });
});

describe("ScheduleTaskBlockResponseDataSchema (cycle-63)", () => {
  const TASK = { id: 7, threadId: null, title: "보고서", estMinutes: 90, due: "2026-06-20", context: null, status: "doing", optional: 0, scheduledEventId: 42, createdAt: null };
  const EVENT = { id: 42, threadId: null, title: "보고서", type: "task", start: "2026-06-28T14:00:00+09:00", end: "2026-06-28T15:30:00+09:00", location: null, mode: "async", source: "cairn", selfImposed: 1, status: "planned", createdAt: null, updatedAt: null };
  it("validates a task + event payload", () => {
    expect(ScheduleTaskBlockResponseDataSchema.safeParse({ task: TASK, event: EVENT }).success).toBe(true);
  });
  it("requires both task and event", () => {
    expect(ScheduleTaskBlockResponseDataSchema.safeParse({ task: TASK }).success).toBe(false);
    expect(ScheduleTaskBlockResponseDataSchema.safeParse({ event: EVENT }).success).toBe(false);
  });
  it("rejects injected score/apply fields (strict)", () => {
    expect(ScheduleTaskBlockResponseDataSchema.safeParse({ task: TASK, event: EVENT, score: 9 }).success).toBe(false);
    expect(ScheduleTaskBlockResponseDataSchema.safeParse({ task: TASK, event: EVENT, applied: true }).success).toBe(false);
  });
});
