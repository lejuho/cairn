import { asc, eq, inArray } from "drizzle-orm";
import type { CreatePersonRequest, EventPeopleResponse, EventRow, FrequencyBand, HardConstraint, PersonDirectoryRow, PersonRow, Weekday } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { eventPeople, events, people } from "../db/schema.js";
import { parseHardConstraints, toFrequencyBand } from "../services/people-impact.js";

// Qualifying meeting predicate shared by directory and decision paths.
// A past meeting is: status done|confirmed AND end is a finite epoch before nowMs.
export function isQualifyingMeet(end: string | null | undefined, status: string | null, nowMs: number): boolean {
  if (!end) return false;
  const endMs = Date.parse(end);
  return Number.isFinite(endMs) && endMs < nowMs && (status === "done" || status === "confirmed");
}

export function findAllPeople(db: CairnDatabase): PersonRow[] {
  const rows = db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel, hardConstraintsJson: people.hardConstraints })
    .from(people)
    .orderBy(asc(people.name), asc(people.id))
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    relation: r.relation ?? null,
    channel: r.channel as PersonRow["channel"] ?? null,
    hardConstraints: parseHardConstraints(r.hardConstraintsJson ?? null)
  }));
}

export function findPersonById(db: CairnDatabase, id: number): PersonRow | null {
  const row = db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel, hardConstraintsJson: people.hardConstraints })
    .from(people)
    .where(eq(people.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    relation: row.relation ?? null,
    channel: row.channel as PersonRow["channel"] ?? null,
    hardConstraints: parseHardConstraints(row.hardConstraintsJson ?? null)
  };
}

export type MeetingStats = { totalMeets: number; lastMet: string | null };

export function queryMeetingStats(
  db: CairnDatabase,
  personIds: number[],
  nowIso: string
): Map<number, MeetingStats> {
  const result = new Map<number, MeetingStats>();
  if (personIds.length === 0) return result;
  // Count qualifying past events: done or confirmed, ended before now.
  // Use epoch ms comparison — RFC3339 strings with mixed offsets (+09:00 vs Z)
  // are not lexically sortable, so string < would misclassify cross-offset rows.
  const nowMs = Date.parse(nowIso);
  const rows = db
    .select({
      personId: eventPeople.personId,
      end: events.end,
      status: events.status
    })
    .from(eventPeople)
    .innerJoin(events, eq(eventPeople.eventId, events.id))
    .where(
      inArray(eventPeople.personId, personIds)
    )
    .all()
    .filter((r) => isQualifyingMeet(r.end, r.status, nowMs));

  for (const personId of personIds) {
    const mine = rows.filter((r) => r.personId === personId);
    const totalMeets = mine.length;
    const lastMet = mine.length > 0
      ? mine.reduce((best, r) => (Date.parse(r.end!) > Date.parse(best) ? r.end! : best), mine[0]!.end!)
      : null;
    result.set(personId, { totalMeets, lastMet });
  }
  return result;
}

export type PersonContextItem = {
  personId: number;
  personName: string;
  hardConstraints: HardConstraint[];
  totalMeets: number;
  lastMet: string | null;
};

export function findEventPeopleContext(
  db: CairnDatabase,
  eventIds: number[],
  nowIso: string
): Map<number, PersonContextItem[]> {
  const result = new Map<number, PersonContextItem[]>();
  if (eventIds.length === 0) return result;

  const links = db
    .select({
      eventId: eventPeople.eventId,
      personId: people.id,
      personName: people.name,
      hardConstraintsJson: people.hardConstraints
    })
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(inArray(eventPeople.eventId, eventIds))
    .all();

  const personIds = [...new Set(links.map((l) => l.personId))];
  const statsMap = queryMeetingStats(db, personIds, nowIso);

  for (const link of links) {
    const stats = statsMap.get(link.personId) ?? { totalMeets: 0, lastMet: null };
    const item: PersonContextItem = {
      personId: link.personId,
      personName: link.personName,
      hardConstraints: parseHardConstraints(link.hardConstraintsJson ?? null),
      totalMeets: stats.totalMeets,
      lastMet: stats.lastMet
    };
    const existing = result.get(link.eventId) ?? [];
    existing.push(item);
    result.set(link.eventId, existing);
  }
  return result;
}

export function replaceHardConstraints(
  db: CairnDatabase,
  personId: number,
  unavailableWeekdays: Weekday[]
): PersonRow | null {
  const deduped = [...new Set(unavailableWeekdays)] as Weekday[];
  const constraints: HardConstraint[] = deduped.map((weekday) => ({
    type: "weekday_unavailable" as const,
    weekday,
    text: `${weekday} 불가`,
    firmness: "hard" as const
  }));
  const json = constraints.length > 0 ? JSON.stringify(constraints) : null;
  const rows = db
    .update(people)
    .set({ hardConstraints: json })
    .where(eq(people.id, personId))
    .returning()
    .all();
  if (rows.length === 0) return null;
  const updated = rows[0]!;
  return {
    id: updated.id,
    name: updated.name,
    relation: updated.relation ?? null,
    channel: updated.channel as PersonRow["channel"] ?? null,
    hardConstraints: constraints
  };
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
    .orderBy(asc(people.name), asc(people.id))
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

export function findPeopleDirectoryRows(db: CairnDatabase, nowIso: string): PersonDirectoryRow[] {
  const allPeople = db
    .select({ id: people.id, name: people.name, relation: people.relation, channel: people.channel, hardConstraintsJson: people.hardConstraints })
    .from(people)
    .all();

  const personIds = allPeople.map((p) => p.id);
  const statsMap = personIds.length > 0 ? queryMeetingStats(db, personIds, nowIso) : new Map<number, MeetingStats>();

  const rows: PersonDirectoryRow[] = allPeople.map((p) => {
    const stats = statsMap.get(p.id) ?? { totalMeets: 0, lastMet: null };
    const { band } = toFrequencyBand(stats.totalMeets);
    return {
      id: p.id,
      name: p.name,
      relation: p.relation ?? null,
      channel: p.channel as PersonRow["channel"] ?? null,
      hardConstraints: parseHardConstraints(p.hardConstraintsJson ?? null),
      totalMeets: stats.totalMeets,
      lastMet: stats.lastMet,
      frequencyBand: band as FrequencyBand
    };
  });

  // Sort: lastMet desc by epoch (nulls last), then name asc, then id asc
  return rows.sort((a, b) => {
    const aMs = a.lastMet != null ? Date.parse(a.lastMet) : null;
    const bMs = b.lastMet != null ? Date.parse(b.lastMet) : null;
    if (aMs !== null && bMs !== null) {
      if (bMs !== aMs) return bMs - aMs;
    } else if (aMs !== null) return -1;
    else if (bMs !== null) return 1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.id - b.id;
  });
}

export function findRecentMeetings(db: CairnDatabase, personId: number, nowIso: string, limit = 10): EventRow[] {
  const nowMs = Date.parse(nowIso);
  const rows = db
    .select({ events })
    .from(eventPeople)
    .innerJoin(events, eq(eventPeople.eventId, events.id))
    .where(eq(eventPeople.personId, personId))
    .all()
    .filter((r) => isQualifyingMeet(r.events.end, r.events.status, nowMs))
    .sort((a, b) => {
      const aMs = Date.parse(a.events.end!);
      const bMs = Date.parse(b.events.end!);
      if (bMs !== aMs) return bMs - aMs; // newest first
      return a.events.id - b.events.id;  // id asc as tiebreak
    })
    .slice(0, limit)
    .map((r) => ({
      id: r.events.id,
      title: r.events.title,
      start: r.events.start,
      end: r.events.end,
      source: r.events.source as EventRow["source"],
      selfImposed: r.events.selfImposed,
      status: r.events.status as EventRow["status"],
      threadId: r.events.threadId,
      type: r.events.type,
      location: r.events.location,
      createdAt: r.events.createdAt,
      updatedAt: r.events.updatedAt
    }));
  return rows;
}
