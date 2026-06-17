import { asc, eq } from "drizzle-orm";
import type { CreatePersonRequest, EventPeopleResponse, PersonRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { eventPeople, events, people } from "../db/schema.js";

export function findAllPeople(db: CairnDatabase): PersonRow[] {
  return db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel })
    .from(people)
    .orderBy(asc(people.name), asc(people.id))
    .all() as PersonRow[];
}

export function createPerson(db: CairnDatabase, input: CreatePersonRequest): PersonRow {
  const trimmedRelation = input.relation?.trim();
  const rows = db
    .insert(people)
    .values({
      name: input.displayName.trim(),
      relation: trimmedRelation || null,
      channel: input.channel
    })
    .returning()
    .all();
  const row = rows[0]!;
  return { id: row.id, name: row.name, relation: row.relation ?? null, channel: (row.channel as PersonRow["channel"]) ?? null };
}

export function findEventWithPeople(db: CairnDatabase, eventId: number): EventPeopleResponse | null {
  const eventRows = db.select().from(events).where(eq(events.id, eventId)).all();
  if (eventRows.length === 0) return null;
  const event = eventRows[0];
  const personRows = db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel })
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(eq(eventPeople.eventId, eventId))
    .all() as PersonRow[];
  return { event: event as EventPeopleResponse["event"], people: personRows };
}

export function replaceEventPeople(
  db: CairnDatabase,
  eventId: number,
  personIds: number[]
): PersonRow[] {
  const deduped = [...new Set(personIds)];
  db.transaction((tx) => {
    tx.delete(eventPeople).where(eq(eventPeople.eventId, eventId)).run();
    if (deduped.length > 0) {
      tx.insert(eventPeople)
        .values(deduped.map((pid) => ({ eventId, personId: pid })))
        .run();
    }
  });
  if (deduped.length === 0) return [];
  return db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel })
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(eq(eventPeople.eventId, eventId))
    .all() as PersonRow[];
}

export function findPeopleByIds(db: CairnDatabase, ids: number[]): PersonRow[] {
  if (ids.length === 0) return [];
  return db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel })
    .from(people)
    .all()
    .filter((p) => ids.includes(p.id)) as PersonRow[];
}
