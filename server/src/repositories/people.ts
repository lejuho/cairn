import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PatchPersonRequest, PersonEventRef, PersonGroupCount } from "@cairn/shared";
import type { AuthoredLeadTime, AuthoredPreferredWindows, CreatePersonRequest, EventPeopleResponse, EventRow, FrequencyBand, HardConstraint, PersonDirectoryRow, PersonRow, ThreadPersonFocusRow, UpdatePersonProfileRequest, Weekday } from "@cairn/shared";
import type { CairnDatabase, CairnDbExecutor } from "../db/index.js";
import { eventPeople, events, noteLinks, people, resources } from "../db/schema.js";
import { parseHardConstraints, parseLeadTime, parsePreferredWindows, toFrequencyBand } from "../services/people-impact.js";

// Full person column projection — used by all single-table reads.
const PERSON_COLS = {
  id: people.id,
  name: people.name,
  relation: people.relation,
  channel: people.channel,
  groupsJson: people.groups,
  gender: people.gender,
  hardConstraintsJson: people.hardConstraints,
  preferredWindowsJson: people.preferredWindows,
  leadTimeJson: people.leadTime
} as const;

type PersonFullRow = {
  id: number;
  name: string;
  relation: string | null;
  channel: string | null;
  groupsJson: string | null;
  gender: string | null;
  hardConstraintsJson: string | null;
  preferredWindowsJson: string | null;
  leadTimeJson: string | null;
};

function parseGroups(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((g): g is string => typeof g === "string" && g.trim() !== "") : [];
  } catch {
    return [];
  }
}

function cleanGroups(groups: string[] | undefined): string | null {
  const seen = [...new Set((groups ?? []).map((g) => g.trim()).filter(Boolean))];
  return seen.length > 0 ? JSON.stringify(seen) : null;
}

function mapPersonRow(r: PersonFullRow): PersonRow {
  return {
    id: r.id,
    name: r.name,
    relation: r.relation ?? null,
    groups: parseGroups(r.groupsJson),
    gender: r.gender === "male" || r.gender === "female" ? r.gender : null,
    channel: r.channel as PersonRow["channel"] ?? null,
    hardConstraints: parseHardConstraints(r.hardConstraintsJson ?? null),
    preferredWindows: parsePreferredWindows(r.preferredWindowsJson ?? null),
    leadTime: parseLeadTime(r.leadTimeJson ?? null)
  };
}

// Qualifying meeting predicate shared by directory and decision paths.
// A past meeting is: status done|confirmed AND end is a finite epoch before nowMs.
export function isQualifyingMeet(end: string | null | undefined, status: string | null, nowMs: number): boolean {
  if (!end) return false;
  const endMs = Date.parse(end);
  return Number.isFinite(endMs) && endMs < nowMs && (status === "done" || status === "confirmed");
}

export function findAllPeople(db: CairnDatabase): PersonRow[] {
  return db.select(PERSON_COLS).from(people).orderBy(asc(people.name), asc(people.id)).all().map(mapPersonRow);
}

export function findPersonById(db: CairnDatabase, id: number): PersonRow | null {
  const row = db.select(PERSON_COLS).from(people).where(eq(people.id, id)).get();
  return row ? mapPersonRow(row) : null;
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

// Person Thread Focus A (cycle-66 FR-PPL-07/FR-XREL-03). READ-ONLY: the people
// attached (via event_people) to the given in-thread event ids, each with the
// in-thread event ids they appear on. Deterministic: eventIds unique + asc;
// people sorted name asc then id asc. Caller passes only events that belong to
// the thread, so out-of-thread links never appear. No write.
export function findThreadPersonFocus(db: CairnDatabase, eventIds: number[]): ThreadPersonFocusRow[] {
  if (eventIds.length === 0) return [];
  const rows = db
    .select({
      eventId: eventPeople.eventId,
      personId: people.id,
      personName: people.name,
      relation: people.relation
    })
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(inArray(eventPeople.eventId, eventIds))
    .all();

  const byPerson = new Map<number, { person: { id: number; name: string; relation: string | null }; eventIds: Set<number> }>();
  for (const r of rows) {
    let entry = byPerson.get(r.personId);
    if (!entry) {
      entry = { person: { id: r.personId, name: r.personName, relation: r.relation ?? null }, eventIds: new Set<number>() };
      byPerson.set(r.personId, entry);
    }
    if (r.eventId != null) entry.eventIds.add(r.eventId);
  }

  return [...byPerson.values()]
    .map((e) => ({ person: e.person, eventIds: [...e.eventIds].sort((a, b) => a - b) }))
    .sort((a, b) => (a.person.name < b.person.name ? -1 : a.person.name > b.person.name ? 1 : a.person.id - b.person.id));
}

export function replaceHardConstraints(
  db: CairnDatabase,
  personId: number,
  unavailableWeekdays: Weekday[]
): PersonRow | null | "conflict" {
  const deduped = [...new Set(unavailableWeekdays)] as Weekday[];

  // Guard: an unavailable day must not be in the person's existing preferredWindows.
  const existing = findPersonById(db, personId);
  if (!existing) return null;
  const existingPrefDays = existing.preferredWindows?.weekdays ?? [];
  const overlap = deduped.filter((d) => existingPrefDays.includes(d));
  if (overlap.length > 0) return "conflict";

  const constraints: HardConstraint[] = deduped.map((weekday) => ({
    type: "weekday_unavailable" as const,
    weekday,
    text: `${weekday} 불가`,
    firmness: "hard" as const
  }));
  const json = constraints.length > 0 ? JSON.stringify(constraints) : null;
  const rows = db.update(people).set({ hardConstraints: json }).where(eq(people.id, personId)).returning(PERSON_COLS).all();
  if (rows.length === 0) return null;
  return mapPersonRow(rows[0]!);
}

export function createPerson(db: CairnDatabase, input: CreatePersonRequest): PersonRow {
  const trimmedRelation = input.relation?.trim();
  const rows = db
    .insert(people)
    .values({ name: input.displayName.trim(), relation: trimmedRelation || null, channel: input.channel, groups: cleanGroups(input.groups), gender: input.gender ?? null })
    .returning(PERSON_COLS)
    .all();
  return mapPersonRow(rows[0]!);
}

export function updatePersonBasics(db: CairnDatabase, id: number, patch: PatchPersonRequest): PersonRow | null {
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.relation !== undefined ? { relation: patch.relation || null } : {}),
    ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
    ...(patch.groups !== undefined ? { groups: cleanGroups(patch.groups) } : {}),
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned ? 1 : 0 } : {})
  };
  const rows = db.update(people).set(set).where(eq(people.id, id)).returning(PERSON_COLS).all();
  return rows[0] ? mapPersonRow(rows[0]) : null;
}

export type PersonUsage = { events: number; notes: number; resources: number };

// What still points at a person: events they attend, notes kept on them, resources they gave.
export function personUsage(db: CairnDatabase, id: number): PersonUsage {
  const count = (n: { n: number } | undefined) => Number(n?.n ?? 0);
  return {
    events: count(db.select({ n: sql<number>`count(*)` }).from(eventPeople).where(eq(eventPeople.personId, id)).get()),
    notes: count(db.select({ n: sql<number>`count(*)` }).from(noteLinks).where(and(eq(noteLinks.targetType, "person"), eq(noteLinks.targetId, id))).get()),
    resources: count(db.select({ n: sql<number>`count(*)` }).from(resources).where(eq(resources.sourcePersonId, id)).get())
  };
}

// Removes the person and unhooks them from events, notes and resources. The events, notes and
// resources themselves stay.
export function deletePerson(db: CairnDatabase, id: number): boolean {
  if (!db.select({ id: people.id }).from(people).where(eq(people.id, id)).get()) return false;
  db.transaction((tx) => {
    tx.delete(eventPeople).where(eq(eventPeople.personId, id)).run();
    tx.delete(noteLinks).where(and(eq(noteLinks.targetType, "person"), eq(noteLinks.targetId, id))).run();
    tx.update(resources).set({ sourcePersonId: null }).where(eq(resources.sourcePersonId, id)).run();
    tx.delete(people).where(eq(people.id, id)).run();
  });
  return true;
}

// Every group name in use, most used first.
export function listPersonGroups(db: CairnDatabase): PersonGroupCount[] {
  const counts = new Map<string, number>();
  for (const row of db.select({ groups: people.groups }).from(people).all()) {
    for (const g of parseGroups(row.groups)) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Canonical weekday ordering for normalization.
const WEEKDAY_ORDER: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// Canonical period ordering.
const PERIOD_ORDER = ["morning", "afternoon", "evening"] as const;

export function updatePersonProfile(
  db: CairnDatabase,
  personId: number,
  input: UpdatePersonProfileRequest
): PersonRow | null {
  // Normalize: dedup in canonical order.
  const prefWeekdays = WEEKDAY_ORDER.filter((d) => input.preferredWeekdays.includes(d));
  const unavailWeekdays = WEEKDAY_ORDER.filter((d) => input.unavailableWeekdays.includes(d));
  const prefPeriods = PERIOD_ORDER.filter((p) => input.preferredPeriods.includes(p));

  // Contradiction: a day cannot be both preferred and unavailable.
  const overlap = prefWeekdays.filter((d) => unavailWeekdays.includes(d));
  if (overlap.length > 0) return null; // caller converts to 400

  // Half-empty: one of weekdays/periods non-empty while the other is empty.
  const hasWeekdays = prefWeekdays.length > 0;
  const hasPeriods = prefPeriods.length > 0;
  if (hasWeekdays !== hasPeriods) return null; // caller converts to 400

  // Build canonical JSON values.
  let preferredWindowsJson: string | null = null;
  if (hasWeekdays && hasPeriods) {
    const win: AuthoredPreferredWindows = { weekdays: prefWeekdays, periods: prefPeriods as AuthoredPreferredWindows["periods"], firmness: "hard" };
    preferredWindowsJson = JSON.stringify(win);
  }

  const constraints: HardConstraint[] = unavailWeekdays.map((weekday) => ({
    type: "weekday_unavailable" as const,
    weekday,
    text: `${weekday} 불가`,
    firmness: "hard" as const
  }));
  const hardConstraintsJson = constraints.length > 0 ? JSON.stringify(constraints) : null;

  let leadTimeJson: string | null = null;
  if (input.leadTimeDays !== null) {
    const lt: AuthoredLeadTime = { days: input.leadTimeDays, firmness: "hard" };
    leadTimeJson = JSON.stringify(lt);
  }

  const rows = db
    .update(people)
    .set({
      channel: input.channel,
      preferredWindows: preferredWindowsJson,
      hardConstraints: hardConstraintsJson,
      leadTime: leadTimeJson
    })
    .where(eq(people.id, personId))
    .returning(PERSON_COLS)
    .all();

  if (rows.length === 0) return null;
  return mapPersonRow(rows[0]!);
}

export function findEventPeopleFullProfiles(db: CairnDbExecutor, eventId: number): PersonRow[] {
  return db
    .select(PERSON_COLS)
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(eq(eventPeople.eventId, eventId))
    .orderBy(asc(people.name), asc(people.id))
    .all()
    .map(mapPersonRow);
}

export function findEventWithPeople(db: CairnDatabase, eventId: number): EventPeopleResponse | null {
  const eventRows = db.select().from(events).where(eq(events.id, eventId)).all();
  if (eventRows.length === 0) return null;
  const event = eventRows[0];
  const personRows = db
    .select(PERSON_COLS)
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(eq(eventPeople.eventId, eventId))
    .orderBy(asc(people.name), asc(people.id))
    .all()
    .map(mapPersonRow);
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
    .select(PERSON_COLS)
    .from(eventPeople)
    .innerJoin(people, eq(eventPeople.personId, people.id))
    .where(eq(eventPeople.eventId, eventId))
    .all()
    .map(mapPersonRow);
}

export function findPeopleByIds(db: CairnDatabase, ids: number[]): PersonRow[] {
  if (ids.length === 0) return [];
  return db
    .select(PERSON_COLS)
    .from(people)
    .all()
    .filter((p) => ids.includes(p.id))
    .map(mapPersonRow);
}

const NEAR_MS = 30 * 86_400_000;

// For each person: the nearest event still ahead and the latest one behind, within 30 days.
// Cancelled events do not count either way.
function nearEvents(db: CairnDatabase, nowMs: number): Map<number, { upcoming: PersonEventRef | null; recent: PersonEventRef | null }> {
  const rows = db
    .select({ personId: eventPeople.personId, eventId: events.id, title: events.title, start: events.start, end: events.end, status: events.status })
    .from(eventPeople)
    .innerJoin(events, eq(eventPeople.eventId, events.id))
    .all();
  const out = new Map<number, { upcoming: PersonEventRef | null; recent: PersonEventRef | null }>();
  for (const r of rows) {
    if (!r.start || r.status === "cancelled") continue;
    const startMs = Date.parse(r.start);
    const endMs = r.end ? Date.parse(r.end) : startMs;
    if (!Number.isFinite(startMs)) continue;
    const entry = out.get(r.personId) ?? { upcoming: null, recent: null };
    const ref = { eventId: r.eventId, title: r.title, start: r.start };
    if (endMs >= nowMs && startMs <= nowMs + NEAR_MS) {
      if (!entry.upcoming || startMs < Date.parse(entry.upcoming.start)) entry.upcoming = ref;
    } else if (endMs < nowMs && startMs >= nowMs - NEAR_MS) {
      if (!entry.recent || startMs > Date.parse(entry.recent.start)) entry.recent = ref;
    }
    out.set(r.personId, entry);
  }
  return out;
}

export function findPeopleDirectoryRows(db: CairnDatabase, nowIso: string): PersonDirectoryRow[] {
  const allPeople = db.select(PERSON_COLS).from(people).all();
  const near = nearEvents(db, Date.parse(nowIso));
  const pinnedIds = new Set(db.select({ id: people.id }).from(people).where(eq(people.pinned, 1)).all().map((r) => r.id));

  const personIds = allPeople.map((p) => p.id);
  const statsMap = personIds.length > 0 ? queryMeetingStats(db, personIds, nowIso) : new Map<number, MeetingStats>();

  const rows: PersonDirectoryRow[] = allPeople.map((p) => {
    const stats = statsMap.get(p.id) ?? { totalMeets: 0, lastMet: null };
    const { band } = toFrequencyBand(stats.totalMeets);
    return {
      ...mapPersonRow(p),
      upcoming: near.get(p.id)?.upcoming ?? null,
      recent: near.get(p.id)?.recent ?? null,
      pinned: pinnedIds.has(p.id),
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
      mode: r.events.mode as EventRow["mode"],
      createdAt: r.events.createdAt,
      updatedAt: r.events.updatedAt
    }));
  return rows;
}
