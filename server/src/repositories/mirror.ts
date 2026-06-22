import { desc, eq, or } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { annotations, events, threads } from "../db/schema.js";

// One annotation joined to its event (and optional thread). Event/thread fields
// are nullable because the join may miss (orphan annotation, threadless event).
export type MirrorSourceRow = {
  annotationId: number;
  eventId: number | null;
  eventTitle: string | null;
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
