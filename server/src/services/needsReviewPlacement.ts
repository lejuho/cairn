import type { EventRow, NeedsReviewPlacement, TransitionCost } from "@cairn/shared";

const STALE_THRESHOLD_HOURS = 12;
const MS_PER_HOUR = 1000 * 60 * 60;

// Nonnegative integer hours since the reviewed event ended, clamped at 0 for
// future ends. null when end is missing/invalid (never fabricate staleness).
function computeAgeHours(end: string | null, now: string): number | null {
  if (end == null) return null;
  const endMs = Date.parse(end);
  const nowMs = Date.parse(now);
  if (Number.isNaN(endMs) || Number.isNaN(nowMs)) return null;
  const ageMs = nowMs - endMs;
  if (ageMs <= 0) return 0;
  return Math.floor(ageMs / MS_PER_HOUR);
}

// First transition (deterministic scheduled order) where the reviewed event
// participates with a low-cost context level. Returns the anchor (the other
// endpoint), or null when none qualifies.
function findLowContextAnchor(eventId: number, transitionCosts: TransitionCost[]): number | null {
  for (const t of transitionCosts) {
    if (t.costLevel !== "none" && t.costLevel !== "low") continue;
    if (t.fromEventId === eventId) return t.toEventId;
    if (t.toEventId === eventId) return t.fromEventId;
  }
  return null;
}

// Pure deterministic placement for one needs-review event.
// `dayEvents` is intentionally not an input: `transitionCosts` already encodes
// same-day adjacency (its rows reference only day-scheduled event ids), so an
// event absent from the day cannot match a low-context slot.
export function computeNeedsReviewPlacement(
  event: EventRow,
  transitionCosts: TransitionCost[],
  now: string
): NeedsReviewPlacement {
  const ageHours = computeAgeHours(event.end, now);
  const anchorEventId = findLowContextAnchor(event.id, transitionCosts);

  if (anchorEventId != null) {
    return {
      mode: "low_context_slot",
      anchorEventId,
      ageHours,
      reasonCodes: ["placement_low_context_slot"]
    };
  }

  if (ageHours != null && ageHours >= STALE_THRESHOLD_HOURS) {
    return {
      mode: "stale_due",
      anchorEventId: null,
      ageHours,
      reasonCodes: ["placement_stale_due"]
    };
  }

  return {
    mode: "no_context",
    anchorEventId: null,
    ageHours,
    reasonCodes: ["placement_no_context"]
  };
}
