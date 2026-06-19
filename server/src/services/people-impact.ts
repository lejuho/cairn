import type { HardConstraint, PeopleGuard, RelationshipContribution, SocialContext, Weekday } from "@cairn/shared";
import type { PersonContextItem } from "../repositories/people.js";

const WEEKDAY_NAMES: Weekday[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
];

// Parses hard_constraints JSON from DB. Fail-open: any malformed entry is silently dropped.
export function parseHardConstraints(json: string | null): HardConstraint[] {
  if (!json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const result: HardConstraint[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      item.type === "weekday_unavailable" &&
      typeof item.weekday === "string" &&
      WEEKDAY_NAMES.includes(item.weekday as Weekday) &&
      item.firmness === "hard" &&
      typeof item.text === "string"
    ) {
      result.push({
        type: "weekday_unavailable",
        weekday: item.weekday as Weekday,
        text: item.text,
        firmness: "hard"
      });
    }
  }
  return result;
}

export type FrequencyBand = "cold_start" | "rare" | "established" | "frequent";

export function toFrequencyBand(totalMeets: number): { band: FrequencyBand; adjustment: number } {
  if (totalMeets === 0) return { band: "cold_start", adjustment: 0 };
  if (totalMeets <= 2) return { band: "rare", adjustment: 2 };
  if (totalMeets <= 7) return { band: "established", adjustment: 1 };
  return { band: "frequent", adjustment: 0 };
}

export function computeSocialContext(
  baseSocial: number | null,
  people: PersonContextItem[]
): SocialContext {
  if (people.length === 0) {
    return {
      base: baseSocial,
      adjustment: null,
      effective: baseSocial,
      confidence: "none",
      contributions: []
    };
  }

  const contributions: RelationshipContribution[] = people.map((p) => {
    const { band, adjustment } = toFrequencyBand(p.totalMeets);
    return {
      personId: p.personId,
      personName: p.personName,
      totalMeets: p.totalMeets,
      lastMet: p.lastMet,
      frequencyBand: band,
      adjustment
    };
  });

  const allColdStart = contributions.every((c) => c.frequencyBand === "cold_start");
  const adjustment = contributions.reduce((sum, c) => sum + c.adjustment, 0);
  const base = baseSocial;
  const effective = base != null ? base + adjustment : adjustment > 0 ? adjustment : null;
  const confidence: SocialContext["confidence"] = allColdStart ? "cold_start" : "derived";

  return { base, adjustment, effective, confidence, contributions };
}

// Extract literal calendar date (YYYY-MM-DD prefix) and return weekday name.
// Uses UTC day to match the literal stored date, not a server-timezone-adjusted one.
export function extractWeekday(isoStart: string | null): Weekday | null {
  if (!isoStart) return null;
  const prefix = isoStart.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return null;
  const d = new Date(prefix + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  return WEEKDAY_NAMES[d.getUTCDay()] ?? null;
}

export function evaluatePeopleGuard(
  keptEventId: number,
  keptEventStart: string | null,
  keptPeople: PersonContextItem[]
): PeopleGuard {
  const keptWeekday = extractWeekday(keptEventStart);
  if (!keptWeekday || keptPeople.length === 0) {
    return { blocked: false, keepEventId: keptEventId, reasonCodes: [], constraints: [] };
  }

  const blockingConstraints: PeopleGuard["constraints"] = [];
  for (const person of keptPeople) {
    for (const constraint of person.hardConstraints) {
      if (constraint.type === "weekday_unavailable" && constraint.firmness === "hard" && constraint.weekday === keptWeekday) {
        blockingConstraints.push({
          personId: person.personId,
          personName: person.personName,
          keptEventId,
          constraintText: constraint.text
        });
      }
    }
  }

  if (blockingConstraints.length === 0) {
    return { blocked: false, keepEventId: keptEventId, reasonCodes: [], constraints: [] };
  }

  return {
    blocked: true,
    keepEventId: keptEventId,
    reasonCodes: ["weekday_unavailable"],
    constraints: blockingConstraints
  };
}
