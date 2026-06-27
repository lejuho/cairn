import { and, asc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { CreateEventRequest, EventRow, PatchThreadEventNodeRequest } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { annotations, eventPeople, events } from "../db/schema.js";
import { rfc3339ToMs } from "../utils/rfc3339.js";

// Structural cost-evidence shape applied to an event. Defined locally so the
// repository layer does not import from the service layer (the parser's
// GmailCostEvidence is structurally assignable to this).
export type GmailCostEvidenceInput = {
  cancelMoney?: number;
  refundCutoff?: string;
};

export function insertRawEvent(db: CairnDatabase, title: string): EventRow {
  const [row] = db
    .insert(events)
    .values({
      title,
      start: null,
      end: null,
      threadId: null,
      source: "cairn",
      selfImposed: 1,
      status: "planned"
    })
    .returning()
    .all();
  return row as EventRow;
}

export function createEvent(db: CairnDatabase, input: CreateEventRequest): EventRow {
  const [row] = db
    .insert(events)
    .values({
      title: input.title,
      start: input.start,
      end: input.end,
      type: input.type ?? null,
      location: input.location ?? null,
      mode: input.mode ?? null,
      threadId: input.threadId ?? null,
      source: "cairn",
      selfImposed: 1,
      status: "planned"
    })
    .returning()
    .all();
  return row as EventRow;
}

export function createEventWithPeople(
  db: CairnDatabase,
  input: CreateEventRequest,
  personIds: number[]
): EventRow {
  return db.transaction((tx) => {
    const rows = tx
      .insert(events)
      .values({
        title: input.title,
        start: input.start,
        end: input.end,
        type: input.type ?? null,
        location: input.location ?? null,
        mode: input.mode ?? null,
        threadId: input.threadId ?? null,
        source: "cairn",
        selfImposed: 1,
        status: "planned"
      })
      .returning()
      .all();
    const event = rows[0]!;
    if (personIds.length > 0) {
      tx.insert(eventPeople)
        .values(personIds.map((pid) => ({ eventId: event.id, personId: pid })))
        .run();
    }
    return event as EventRow;
  });
}

export function findEventsByDate(
  db: CairnDatabase,
  date: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .where(eq(events.status, "planned"))
    .all()
    .filter((e) => e.start != null && e.start.startsWith(date)) as EventRow[];
}

export function findNeedsReviewEvents(
  db: CairnDatabase,
  nowIso: string,
  windowStartIso: string,
  limit = 3
): EventRow[] {
  const rows = db
    .select({ event: events })
    .from(events)
    .leftJoin(annotations, eq(annotations.eventId, events.id))
    .where(
      and(
        or(eq(events.status, "planned"), eq(events.status, "confirmed")),
        isNotNull(events.end),
        isNull(annotations.id)
      )
    )
    .all();

  const nowMs = new Date(nowIso).getTime();
  const windowMs = new Date(windowStartIso).getTime();

  return rows
    .map((r) => r.event as EventRow)
    .filter((e) => {
      const endMs = new Date(e.end!).getTime();
      return endMs <= nowMs && endMs >= windowMs;
    })
    .sort((a, b) => new Date(b.end!).getTime() - new Date(a.end!).getTime())
    .slice(0, limit);
}

// scope-bound: full table scan + in-memory filter. Acceptable for Pi-local small dataset (Cycle 2).
export function findEventById(db: CairnDatabase, id: number): EventRow | null {
  const row = db.select().from(events).where(eq(events.id, id)).get();
  return row ? (row as EventRow) : null;
}

export function updateEventStatus(db: CairnDatabase, eventId: number, status: string): void {
  db.update(events).set({ status }).where(eq(events.id, eventId)).run();
}

// Thread node inline edit (cycle-50 FR-THR-06). Mutates ONLY the allowed
// presentation columns that are present in the patch — start/end/status/
// threadId/source are never touched. Uses key presence (`in`) so an explicit
// `null` for type/location/mode is preserved (means "clear"/"unknown").
export function updateEventThreadNode(
  db: CairnDatabase,
  id: number,
  patch: PatchThreadEventNodeRequest
): EventRow | null {
  const set: Partial<typeof events.$inferInsert> = {};
  if ("title" in patch) set.title = patch.title!;
  if ("type" in patch) set.type = patch.type ?? null;
  if ("location" in patch) set.location = patch.location ?? null;
  if ("mode" in patch) set.mode = patch.mode ?? null;
  const [row] = db.update(events).set(set).where(eq(events.id, id)).returning().all();
  return (row as EventRow) ?? null;
}

// Unscheduled Cairn schedule-prompt sources for the given Today date. Excludes
// an event only when it was dismissed FOR THAT date (cycle-61); a NULL or
// different dismiss date still surfaces, so a prompt reappears on a later date
// without a background job.
export function findUnscheduledCairnEvents(db: CairnDatabase, date: string): EventRow[] {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.source, "cairn"),
        eq(events.selfImposed, 1),
        isNull(events.start),
        isNull(events.end),
        eq(events.status, "planned"),
        or(
          isNull(events.schedulePromptDismissedOn),
          ne(events.schedulePromptDismissedOn, date)
        )
      )
    )
    .orderBy(asc(events.id))
    .all() as EventRow[];
}

// Hide a schedule prompt for one Today date. Single guarded UPDATE: the WHERE
// re-checks schedule-prompt eligibility (cairn / self-imposed / still
// unscheduled / planned) so a stale or ineligible event matches no row and the
// route maps that to 409. Mutates ONLY schedule_prompt_dismissed_on + updated_at;
// re-dismissing the same date re-writes the same value (idempotent). Returns
// true iff an eligible row was updated.
export function dismissSchedulePromptForDate(
  db: CairnDatabase,
  eventId: number,
  dismissedOn: string,
  updatedAt: string
): boolean {
  const rows = db
    .update(events)
    .set({ schedulePromptDismissedOn: dismissedOn, updatedAt })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.source, "cairn"),
        eq(events.selfImposed, 1),
        isNull(events.start),
        isNull(events.end),
        eq(events.status, "planned")
      )
    )
    .returning()
    .all();
  return rows.length > 0;
}

export function findEventsInRange(
  db: CairnDatabase,
  rangeStart: string,
  rangeEnd: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .where(
      and(
        isNotNull(events.start),
        isNotNull(events.end),
        ne(events.status, "cancelled")
      )
    )
    .all()
    .filter((e) => rfc3339ToMs(e.start!) < rfc3339ToMs(rangeEnd) && rfc3339ToMs(e.end!) > rfc3339ToMs(rangeStart)) as EventRow[];
}

export function scheduleEvent(
  db: CairnDatabase,
  id: number,
  start: string,
  end: string
): EventRow | null {
  const result = db
    .update(events)
    .set({ start, end })
    .where(
      and(
        eq(events.id, id),
        isNull(events.start),
        isNull(events.end)
      )
    )
    .returning()
    .all();
  return result.length > 0 ? (result[0] as EventRow) : null;
}

export function findPlannedAndConfirmedByDate(
  db: CairnDatabase,
  date: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .orderBy(asc(events.start))
    .all()
    .filter(
      (e) =>
        e.start != null &&
        e.start.startsWith(date) &&
        (e.status === "planned" || e.status === "confirmed")
    ) as EventRow[];
}

// All planned/confirmed events with any start value. Date-range filtering is
// deferred to the pure service (consistent with findPlannedAndConfirmedByDate).
export function findPlannedAndConfirmedAll(db: CairnDatabase): EventRow[] {
  return db
    .select()
    .from(events)
    .orderBy(asc(events.start))
    .all()
    .filter((e) => e.status === "planned" || e.status === "confirmed") as EventRow[];
}

// Read-only: scheduled events (planned|confirmed|done) with a non-null start,
// ordered by start asc then id asc so transition-pair counting is stable for
// equal start times. Date-range filtering is deferred to the pure service
// (mirror-transition-friction), consistent with findPlannedAndConfirmedAll.
export function findScheduledEventsForFriction(db: CairnDatabase): EventRow[] {
  return db
    .select()
    .from(events)
    .orderBy(asc(events.start), asc(events.id))
    .all()
    .filter(
      (e) =>
        e.start != null &&
        (e.status === "planned" || e.status === "confirmed" || e.status === "done")
    ) as EventRow[];
}

export function findEventsWithCostsForDate(
  db: CairnDatabase,
  date: string
): (typeof events.$inferSelect)[] {
  return db
    .select()
    .from(events)
    .orderBy(asc(events.start))
    .all()
    .filter((e) => e.start != null && e.start.startsWith(date));
}

export function findEventWithCosts(
  db: CairnDatabase,
  id: number
): (typeof events.$inferSelect) | null {
  return db.select().from(events).where(eq(events.id, id)).get() ?? null;
}

// Read-only: direct events of a thread WITH cancel-cost columns (cycle-53). The
// standard EventRow type-erases cancel_money/social/effort/window, so settlement
// reads the full row instead. No writes.
export function findEventsWithCostsByThreadId(
  db: CairnDatabase,
  threadId: number
): (typeof events.$inferSelect)[] {
  return db.select().from(events).where(eq(events.threadId, threadId)).all();
}

// Nearest same-thread event that ENDED before `targetStartIso` begins (offset-
// safe epoch compare via rfc3339ToMs, never SQL string compare). Excludes the
// target event itself. Deterministic tie-break: end desc, then id desc. Returns
// null when threadId/targetStart is absent — never guesses from creation time.
export function findNearestPriorThreadEvent(
  db: CairnDatabase,
  threadId: number,
  targetStartIso: string,
  excludeEventId: number
): EventRow | null {
  const startMs = rfc3339ToMs(targetStartIso);
  if (Number.isNaN(startMs)) return null;
  const candidates = db
    .select()
    .from(events)
    .where(and(eq(events.threadId, threadId), isNotNull(events.end), ne(events.id, excludeEventId)))
    .all()
    .filter((e) => {
      const endMs = rfc3339ToMs(e.end!);
      return !Number.isNaN(endMs) && endMs < startMs;
    })
    .sort((a, b) => {
      const diff = rfc3339ToMs(b.end!) - rfc3339ToMs(a.end!);
      return diff !== 0 ? diff : b.id - a.id;
    });
  return candidates.length > 0 ? (candidates[0] as EventRow) : null;
}

// Gmail cost-sync candidates (FR-SYNC-05): imminent EXTERNAL calendar events
// (source='gcal', self_imposed=0) that are still planned/confirmed, start
// within [now, now+lookaheadDays], and are still missing at least one cost
// field. Epoch (UTC) comparison via rfc3339ToMs is offset-safe; the populated
// guard mirrors the write guards so a fully-populated event is never a
// candidate. Deterministic order: start asc, then id asc.
export function findGmailCostCandidateEvents(
  db: CairnDatabase,
  now: string,
  lookaheadDays: number
): (typeof events.$inferSelect)[] {
  const nowMs = rfc3339ToMs(now);
  if (Number.isNaN(nowMs)) return [];
  const horizonMs = nowMs + lookaheadDays * 24 * 60 * 60 * 1000;
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.source, "gcal"),
        eq(events.selfImposed, 0),
        or(eq(events.status, "planned"), eq(events.status, "confirmed")),
        isNotNull(events.start)
      )
    )
    .orderBy(asc(events.start), asc(events.id))
    .all()
    .filter((e) => {
      const startMs = rfc3339ToMs(e.start!);
      if (Number.isNaN(startMs)) return false;
      if (startMs < nowMs || startMs > horizonMs) return false;
      const moneyEmpty = e.cancelMoney === 0 || e.cancelMoney === null;
      const cutoffEmpty = e.refundCutoff === null;
      return moneyEmpty || cutoffEmpty;
    });
}

// Apply extracted Gmail cost evidence to a single event. Each field is a separate
// guarded UPDATE so a populated value is never overwritten (cancel_money only
// upgrades from 0/empty; refund_cutoff only fills from null). The WHERE guards
// make the write atomic and idempotent — a rerun with the same evidence changes
// nothing. updated_at is touched only on a real field write.
export function applyGmailCostEvidence(
  db: CairnDatabase,
  eventId: number,
  evidence: GmailCostEvidenceInput,
  updatedAt: string
): { updatedMoney: boolean; updatedCutoff: boolean } {
  let updatedMoney = false;
  let updatedCutoff = false;

  if (evidence.cancelMoney !== undefined && evidence.cancelMoney > 0) {
    const rows = db
      .update(events)
      .set({ cancelMoney: evidence.cancelMoney, updatedAt })
      .where(
        and(
          eq(events.id, eventId),
          or(eq(events.cancelMoney, 0), isNull(events.cancelMoney))
        )
      )
      .returning()
      .all();
    updatedMoney = rows.length > 0;
  }

  if (evidence.refundCutoff !== undefined) {
    const rows = db
      .update(events)
      .set({ refundCutoff: evidence.refundCutoff, updatedAt })
      .where(and(eq(events.id, eventId), isNull(events.refundCutoff)))
      .returning()
      .all();
    updatedCutoff = rows.length > 0;
  }

  return { updatedMoney, updatedCutoff };
}
