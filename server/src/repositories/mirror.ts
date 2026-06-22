import { desc, eq, inArray, or } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { annotations, events, threads } from "../db/schema.js";

// One annotation joined to its event (and optional thread). Event/thread fields
// are nullable because the join may miss (orphan annotation, threadless event).
export type MirrorSourceRow = {
  annotationId: number;
  eventId: number | null;
  eventTitle: string | null;
  eventType: string | null;
  outcome: string | null;
  reasonTags: string | null;
  reasonText: string | null;
  loggedAt: string | null;
  eventStart: string | null;
  threadId: number | null;
  threadName: string | null;
  cancelMoney: number | null;
  cancelSocial: number | null;
  cancelEffort: string | null;
  cancelWindow: string | null;
};

// All four outcomes (done/moved/cancelled/late) joined to events and optional
// threads. Fields are a superset of MirrorSourceRow, reusing the same type.
// Date-range filtering stays in the pure service.
export function findAllOutcomeAnnotations(db: CairnDatabase): MirrorSourceRow[] {
  return db
    .select({
      annotationId: annotations.id,
      eventId: annotations.eventId,
      outcome: annotations.outcome,
      reasonTags: annotations.reasonTags,
      reasonText: annotations.reasonText,
      loggedAt: annotations.loggedAt,
      eventTitle: events.title,
      eventType: events.type,
      eventStart: events.start,
      threadId: events.threadId,
      cancelMoney: events.cancelMoney,
      cancelSocial: events.cancelSocial,
      cancelEffort: events.cancelEffort,
      cancelWindow: events.cancelWindow,
      threadName: threads.name
    })
    .from(annotations)
    .leftJoin(events, eq(annotations.eventId, events.id))
    .leftJoin(threads, eq(events.threadId, threads.id))
    .where(inArray(annotations.outcome, ["done", "moved", "cancelled", "late"]))
    .orderBy(desc(annotations.loggedAt), desc(annotations.id))
    .all() as MirrorSourceRow[];
}

// Read-only: every moved/cancelled annotation with its event cost columns.
// Date-range filtering is done in the pure service (testable, tz-explicit), not
// here. Newest-first ordering matches the service tie-break (loggedAt, id desc).
export function findMovedCancelledAnnotations(db: CairnDatabase): MirrorSourceRow[] {
  return db
    .select({
      annotationId: annotations.id,
      eventId: annotations.eventId,
      outcome: annotations.outcome,
      reasonTags: annotations.reasonTags,
      reasonText: annotations.reasonText,
      loggedAt: annotations.loggedAt,
      eventTitle: events.title,
      eventType: events.type,
      eventStart: events.start,
      threadId: events.threadId,
      cancelMoney: events.cancelMoney,
      cancelSocial: events.cancelSocial,
      cancelEffort: events.cancelEffort,
      cancelWindow: events.cancelWindow,
      threadName: threads.name
    })
    .from(annotations)
    .leftJoin(events, eq(annotations.eventId, events.id))
    .leftJoin(threads, eq(events.threadId, threads.id))
    .where(or(eq(annotations.outcome, "moved"), eq(annotations.outcome, "cancelled")))
    .orderBy(desc(annotations.loggedAt), desc(annotations.id))
    .all() as MirrorSourceRow[];
}
