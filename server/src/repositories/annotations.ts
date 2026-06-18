import { desc, eq } from "drizzle-orm";
import type { AnnotationRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { annotations } from "../db/schema.js";

export function insertRawAnnotation(
  db: CairnDatabase,
  eventId: number,
  reasonText: string
): AnnotationRow {
  const [row] = db
    .insert(annotations)
    .values({ eventId, reasonText })
    .returning()
    .all();
  return toRow(row!);
}

export function updateAnnotationStructured(
  db: CairnDatabase,
  annotationId: number,
  fields: {
    outcome: string | null;
    reasonTags: string | null;
    reasonText: string | null;
    energyAtTime: number | null;
  }
): AnnotationRow {
  const [row] = db
    .update(annotations)
    .set(fields)
    .where(eq(annotations.id, annotationId))
    .returning()
    .all();
  return toRow(row!);
}

export function insertStructuredAnnotation(
  db: CairnDatabase,
  eventId: number,
  fields: {
    outcome: string;
    reasonTags: string;
    reasonText: string;
  }
): AnnotationRow {
  const [row] = db
    .insert(annotations)
    .values({ eventId, outcome: fields.outcome, reasonTags: fields.reasonTags, reasonText: fields.reasonText, energyAtTime: null })
    .returning()
    .all();
  return toRow(row!);
}

export function findAnnotationsByEvent(db: CairnDatabase, eventId: number): AnnotationRow[] {
  return db
    .select()
    .from(annotations)
    .where(eq(annotations.eventId, eventId))
    .orderBy(desc(annotations.id))
    .all()
    .map(toRow);
}

function toRow(row: typeof annotations.$inferSelect): AnnotationRow {
  return {
    id: row.id,
    eventId: row.eventId,
    outcome: row.outcome as AnnotationRow["outcome"],
    reasonTags: row.reasonTags,
    reasonText: row.reasonText,
    energyAtTime: row.energyAtTime,
    loggedAt: row.loggedAt ?? ""
  };
}
