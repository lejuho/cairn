import type { EventRow, SlotCandidate, SlotSuggestionContribution, Weekday, PreferredPeriod } from "@cairn/shared";
import { addDays, addMinutesToRfc3339, rfc3339ToMs } from "../utils/rfc3339.js";
import { findEventsInRange } from "../repositories/events.js";
import { readFeasibilityParamSettings } from "./feasibility-params.js";
import { computeDayFeasibility } from "./feasibility.js";
import { findEventPeopleFullProfiles } from "../repositories/people.js";
import { findAllOutcomeAnnotations, type MirrorSourceRow } from "../repositories/mirror.js";
import type { CairnDatabase } from "../db/index.js";
import type { FeasibilityParams, PersonRow } from "@cairn/shared";

const WINDOW_HOURS = [9, 11, 14, 16, 19];
const DURATION_MINUTES = 60;
const MAX_CANDIDATES = 3;
const FRICTION_SAMPLE_MIN = 3;
const FRICTION_SLIP_THRESHOLD = 0.5;

// Points budget: availability(40) + feasibility(25) + people(20) + friction(15) = 100 max
const PTS_AVAIL_FREE = 40;
const PTS_FEAS_WITHIN = 25;
const PTS_FEAS_DEFICIT = -20;
const PTS_FEAS_GAP_TIGHT = -10;
const PTS_FEAS_GAP_IMPOSSIBLE = -20;
const PTS_FEAS_CONTINUOUS = -10;
const PTS_PEOPLE_PREFERRED = 20;
const PTS_PEOPLE_PARTIAL = 10;
const PTS_PEOPLE_HARD_UNAVAIL = -40;
const PTS_FRICTION_LOW = 15;
const PTS_FRICTION_HIGH_WEEKDAY = -15;
const PTS_FRICTION_HIGH_TYPE = -10;
const PTS_FRICTION_HIGH_THREAD = -10;

const WEEKDAY_JS: Weekday[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
];
const PERIOD_HOURS: Record<PreferredPeriod, (h: number) => boolean> = {
  morning: (h) => h < 12,
  afternoon: (h) => h >= 12 && h < 18,
  evening: (h) => h >= 18
};

function extractOffset(rfc3339: string): string {
  const m = rfc3339.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1]! : "+00:00";
}

function buildCandidateStart(dateStr: string, hour: number, offset: string): string {
  const hh = String(hour).padStart(2, "0");
  return `${dateStr}T${hh}:00:00${offset}`;
}

export function getWeekday(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return WEEKDAY_JS[dt.getUTCDay()]!;
}

export function getScoreLabel(score: number): string {
  if (score >= 75) return "좋음";
  if (score >= 50) return "보통";
  return "낮음";
}

function overlaps(
  eventStart: string,
  eventEnd: string,
  winStart: string,
  winEnd: string
): boolean {
  return rfc3339ToMs(eventStart) < rfc3339ToMs(winEnd) &&
    rfc3339ToMs(eventEnd) > rfc3339ToMs(winStart);
}

// --- Lens scorers (exported for unit tests) ---

export function scoreAvailability(dateStr: string, hour: number): SlotSuggestionContribution {
  const hh = String(hour).padStart(2, "0");
  const endHH = String(hour + 1).padStart(2, "0");
  return {
    lens: "availability",
    label: "겹침",
    impact: "positive",
    points: PTS_AVAIL_FREE,
    confidence: "observed",
    reasonCodes: ["free_window"],
    evidence: [`${dateStr} ${hh}:00–${endHH}:00 사이 겹치는 일정 없음`]
  };
}

export function scoreFeasibility(
  dateStr: string,
  start: string,
  end: string,
  dayEvents: EventRow[],
  params: FeasibilityParams,
  nowStr: string
): SlotSuggestionContribution {
  try {
    const tempEvent = {
      id: -1,
      title: "",
      type: "meeting" as const,
      status: "planned" as const,
      source: "cairn" as const,
      selfImposed: 1 as const,
      start,
      end,
      threadId: null,
      location: null,
      createdAt: null,
      updatedAt: null
    };
    const merged = [...dayEvents, tempEvent as unknown as EventRow];
    // relations omitted: this path reads only energy; transitionCosts unused.
    const feas = computeDayFeasibility(dateStr, nowStr, merged, params);
    const { loadUnits, budgetUnits, deficit } = feas.energy;
    const loadH = loadUnits.toFixed(1);
    const budgetH = budgetUnits.toFixed(1);

    let points = deficit ? PTS_FEAS_DEFICIT : PTS_FEAS_WITHIN;
    const reasonCodes: string[] = [deficit ? "energy_over_budget" : "energy_within_budget"];
    const evidence: string[] = [`예상 load ${loadH}h / 예산 ${budgetH}h${deficit ? " — 초과" : ""}`];

    const worstGapStatus = feas.gaps.reduce<"ok" | "tight" | "impossible">((worst, g) => {
      if (g.status === "impossible") return "impossible";
      if (g.status === "tight" && worst !== "impossible") return "tight";
      return worst;
    }, "ok");
    if (worstGapStatus === "impossible") {
      points += PTS_FEAS_GAP_IMPOSSIBLE;
      reasonCodes.push("gap_impossible");
      evidence.push("인접 일정 간격 불가");
    } else if (worstGapStatus === "tight") {
      points += PTS_FEAS_GAP_TIGHT;
      reasonCodes.push("gap_tight");
      evidence.push("인접 일정 간격 빠듯함");
    }

    if (feas.continuous?.exceedsMax) {
      points += PTS_FEAS_CONTINUOUS;
      reasonCodes.push("continuous_exceeded");
      evidence.push(`연속 일정 ${Math.round(feas.continuous.spanMinutes)}분 — 최대 초과`);
    }

    const impact = points < 0 ? "negative" : points > 0 ? "positive" : "neutral";
    return { lens: "feasibility", label: "체력", impact, points, confidence: "observed", reasonCodes, evidence };
  } catch {
    return {
      lens: "feasibility",
      label: "체력",
      impact: "neutral",
      points: 0,
      confidence: "unavailable",
      reasonCodes: ["feasibility_unavailable"],
      evidence: []
    };
  }
}

export function scorePeople(
  weekday: Weekday,
  hour: number,
  people: PersonRow[]
): SlotSuggestionContribution {
  if (people.length === 0) {
    return {
      lens: "people",
      label: "참여자",
      impact: "neutral",
      points: 0,
      confidence: "cold_start",
      reasonCodes: ["people_no_data"],
      evidence: ["연결된 사람 없음"]
    };
  }

  const allPersonIds = people.map((p) => p.id);

  // Check hard unavailable weekday for any person
  const hardViolators = people.filter((p) =>
    (p.hardConstraints ?? []).some(
      (c) => c.type === "weekday_unavailable" && c.weekday === weekday
    )
  );
  if (hardViolators.length > 0) {
    const names = hardViolators.map((p) => p.name).join(", ");
    return {
      lens: "people",
      label: "참여자",
      impact: "negative",
      points: PTS_PEOPLE_HARD_UNAVAIL,
      confidence: "observed",
      reasonCodes: ["person_unavailable_weekday"],
      evidence: [`${names} — 해당 요일 불가`],
      personIds: hardViolators.map((p) => p.id)
    };
  }

  // Check preferred windows
  const period = (Object.entries(PERIOD_HOURS) as [PreferredPeriod, (h: number) => boolean][]).find(
    ([, pred]) => pred(hour)
  )?.[0];

  const peopleWithPrefs = people.filter((p) => p.preferredWindows != null);
  if (peopleWithPrefs.length === 0) {
    return {
      lens: "people",
      label: "참여자",
      impact: "neutral",
      points: 0,
      confidence: "cold_start",
      reasonCodes: ["people_no_preference"],
      evidence: ["참여자 선호 시간 미설정"],
      personIds: allPersonIds
    };
  }

  const weekdayMatch = peopleWithPrefs.every(
    (p) => p.preferredWindows!.weekdays.includes(weekday)
  );
  const periodMatch = period != null && peopleWithPrefs.every(
    (p) => p.preferredWindows!.periods.includes(period)
  );

  if (weekdayMatch && periodMatch) {
    return {
      lens: "people",
      label: "참여자",
      impact: "positive",
      points: PTS_PEOPLE_PREFERRED,
      confidence: "observed",
      reasonCodes: ["person_preferred_window"],
      evidence: ["관련자 선호 요일·시간대와 맞음"],
      personIds: allPersonIds
    };
  }
  if (weekdayMatch || periodMatch) {
    const detail = weekdayMatch ? "선호 요일 일치" : "선호 시간대 일치";
    return {
      lens: "people",
      label: "참여자",
      impact: "positive",
      points: PTS_PEOPLE_PARTIAL,
      confidence: "observed",
      reasonCodes: ["person_preferred_partial"],
      evidence: [detail],
      personIds: allPersonIds
    };
  }
  return {
    lens: "people",
    label: "참여자",
    impact: "neutral",
    points: 0,
    confidence: "observed",
    reasonCodes: ["person_outside_preference"],
    evidence: ["관련자 선호 시간대 밖"],
    personIds: allPersonIds
  };
}

export function scoreFriction(
  weekday: Weekday,
  eventType: string | null,
  threadId: number | null,
  allAnnotations: MirrorSourceRow[]
): SlotSuggestionContribution {
  // Weekday friction: all annotations where event started on same weekday
  const weekdayRows = allAnnotations.filter((a) => {
    if (!a.eventStart) return false;
    const startDate = a.eventStart.slice(0, 10);
    return getWeekday(startDate) === weekday;
  });
  const weekdaySlipped = weekdayRows.filter(
    (a) => a.outcome === "moved" || a.outcome === "cancelled"
  );

  // Type friction: annotations for same event type
  const typeRows = eventType
    ? allAnnotations.filter((a) => a.eventType === eventType)
    : [];
  const typeSlipped = typeRows.filter(
    (a) => a.outcome === "moved" || a.outcome === "cancelled"
  );

  // Thread friction: annotations for same thread
  const threadRows = threadId !== null
    ? allAnnotations.filter((a) => a.threadId === threadId)
    : [];
  const threadSlipped = threadRows.filter(
    (a) => a.outcome === "moved" || a.outcome === "cancelled"
  );

  const weekdayHasSample = weekdayRows.length >= FRICTION_SAMPLE_MIN;
  const typeHasSample = typeRows.length >= FRICTION_SAMPLE_MIN;
  const threadHasSample = threadRows.length >= FRICTION_SAMPLE_MIN;

  if (!weekdayHasSample && !typeHasSample && !threadHasSample) {
    const evidenceParts: string[] = [];
    evidenceParts.push(`요일 표본 ${weekdayRows.length}건 (기준 미달)`);
    if (eventType) evidenceParts.push(`유형 표본 ${typeRows.length}건 (기준 미달)`);
    if (threadId !== null) evidenceParts.push(`스레드 표본 ${threadRows.length}건 (기준 미달)`);
    return {
      lens: "friction",
      label: "마찰",
      impact: "neutral",
      points: 0,
      confidence: "cold_start",
      reasonCodes: ["friction_low_sample"],
      evidence: evidenceParts
    };
  }

  let points = 0;
  const reasonCodes: string[] = [];
  const evidence: string[] = [];

  if (weekdayHasSample) {
    const slipRate = weekdaySlipped.length / weekdayRows.length;
    if (slipRate > FRICTION_SLIP_THRESHOLD) {
      points += PTS_FRICTION_HIGH_WEEKDAY;
      reasonCodes.push("friction_high_weekday");
      evidence.push(`해당 요일 이탈률 ${Math.round(slipRate * 100)}% (${weekdaySlipped.length}/${weekdayRows.length}건)`);
    } else {
      points += PTS_FRICTION_LOW;
      reasonCodes.push("friction_low");
      evidence.push(`해당 요일 이탈률 ${Math.round(slipRate * 100)}% (${weekdaySlipped.length}/${weekdayRows.length}건) — 낮음`);
    }
  } else {
    evidence.push(`요일 표본 ${weekdayRows.length}건 (기준 미달)`);
  }

  if (typeHasSample) {
    const slipRate = typeSlipped.length / typeRows.length;
    if (slipRate > FRICTION_SLIP_THRESHOLD) {
      points += PTS_FRICTION_HIGH_TYPE;
      reasonCodes.push("friction_high_type");
      evidence.push(`유형(${eventType}) 이탈률 ${Math.round(slipRate * 100)}% (${typeSlipped.length}/${typeRows.length}건)`);
    }
  } else if (eventType) {
    evidence.push(`유형 표본 ${typeRows.length}건 (기준 미달)`);
  }

  if (threadHasSample) {
    const slipRate = threadSlipped.length / threadRows.length;
    if (slipRate > FRICTION_SLIP_THRESHOLD) {
      points += PTS_FRICTION_HIGH_THREAD;
      reasonCodes.push("friction_high_thread");
      evidence.push(`스레드 이탈률 ${Math.round(slipRate * 100)}% (${threadSlipped.length}/${threadRows.length}건)`);
    }
  } else if (threadId !== null) {
    evidence.push(`스레드 표본 ${threadRows.length}건 (기준 미달)`);
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push("friction_low");
  }

  const impact = points < 0 ? "negative" : points > 0 ? "positive" : "neutral";
  return {
    lens: "friction",
    label: "마찰",
    impact,
    points,
    confidence: "observed",
    reasonCodes,
    evidence
  };
}

// --- Main export ---

// Scoring context for a candidate target (an event or a task's virtual event).
// excludeEventId is the real event id to skip in overlap checks (null for a
// task, which is not an events-table row). durationMinutes lets a task supply
// its own est_minutes; events keep the fixed 60-minute window.
type CandidateContext = {
  durationMinutes: number;
  type: string | null;
  threadId: number | null;
  people: PersonRow[];
  excludeEventId: number | null;
};

function generateCandidatesFor(
  db: CairnDatabase,
  ctx: CandidateContext,
  nowStr: string,
  startDate: string,
  days: number
): SlotCandidate[] {
  const offset = extractOffset(nowStr);
  const rangeEnd = addDays(startDate, days);
  const rangeEndStr = `${rangeEnd}T23:59:59${offset}`;
  const rangeStartStr = `${startDate}T00:00:00${offset}`;
  const allEventsInRange = findEventsInRange(db, rangeStartStr, rangeEndStr);

  const { params } = readFeasibilityParamSettings(db);
  const annotations = findAllOutcomeAnnotations(db);

  type RawCandidate = {
    start: string;
    end: string;
    contributions: SlotSuggestionContribution[];
    score: number;
  };

  const raw: RawCandidate[] = [];

  for (let day = 0; day < days; day++) {
    const dateStr = addDays(startDate, day);
    const weekday = getWeekday(dateStr);
    const dayEvents = allEventsInRange.filter(
      (e) => e.start != null && e.start.startsWith(dateStr)
    );

    for (const hour of WINDOW_HOURS) {
      const start = buildCandidateStart(dateStr, hour, offset);
      const end = addMinutesToRfc3339(start, ctx.durationMinutes);

      if (rfc3339ToMs(start) <= rfc3339ToMs(nowStr)) continue;

      const hasOverlap = allEventsInRange.some(
        (e) => (ctx.excludeEventId == null || e.id !== ctx.excludeEventId) &&
          e.start != null && e.end != null &&
          overlaps(e.start, e.end, start, end)
      );
      if (hasOverlap) continue;

      const contributions: SlotSuggestionContribution[] = [
        scoreAvailability(dateStr, hour),
        scoreFeasibility(dateStr, start, end, dayEvents, params, nowStr),
        scorePeople(weekday, hour, ctx.people),
        scoreFriction(weekday, ctx.type, ctx.threadId, annotations)
      ];

      const score = Math.max(0, contributions.reduce((acc, c) => acc + c.points, 0));
      raw.push({ start, end, contributions, score });
    }
  }

  // Sort: score desc, start asc (deterministic tie-break)
  raw.sort((a, b) => b.score - a.score || rfc3339ToMs(a.start) - rfc3339ToMs(b.start));

  return raw.slice(0, MAX_CANDIDATES).map((c, i) => {
    const reasons = c.contributions.flatMap((contrib) => contrib.evidence);
    const reasonCodes = c.contributions.flatMap((contrib) => contrib.reasonCodes);
    return {
      start: c.start,
      end: c.end,
      score: c.score,
      rank: i + 1,
      scoreLabel: getScoreLabel(c.score),
      reasons,
      reasonCodes,
      contributions: c.contributions
    };
  });
}

export function generateSlotCandidates(
  db: CairnDatabase,
  event: EventRow,
  nowStr: string,
  startDate: string,
  days: number
): SlotCandidate[] {
  const people = findEventPeopleFullProfiles(db, event.id);
  return generateCandidatesFor(
    db,
    { durationMinutes: DURATION_MINUTES, type: event.type, threadId: event.threadId, people, excludeEventId: event.id },
    nowStr,
    startDate,
    days
  );
}

// Read-only task slot preview (cycle-62 FR-SLOT-06C). Uses the task's own
// est_minutes as the candidate duration — no 60-minute fallback. A task is not
// an events-table row, so no self-exclusion and no event people are involved.
export function generateTaskSlotCandidates(
  db: CairnDatabase,
  task: { threadId: number | null; estMinutes: number },
  nowStr: string,
  startDate: string,
  days: number
): SlotCandidate[] {
  return generateCandidatesFor(
    db,
    { durationMinutes: task.estMinutes, type: null, threadId: task.threadId, people: [], excludeEventId: null },
    nowStr,
    startDate,
    days
  );
}
