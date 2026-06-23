import { eq, inArray } from "drizzle-orm";
import type { EgoGraphFirmness } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  eventPeople,
  events,
  people,
  resourceLinks,
  resources,
  tasks,
  threads
} from "../db/schema.js";
import type { RawEdge, RawNeighbor } from "../services/ego-graph.js";

export type ResourceCenterData = {
  resource: { id: number; name: string; kind: string; sourcePersonId: number | null };
  sourcePerson: { id: number; name: string } | null;
  neighbors: RawNeighbor[];
  edges: RawEdge[];
};

export type PersonCenterData = {
  person: { id: number; name: string };
  neighbors: RawNeighbor[];
  edges: RawEdge[];
};

export function findPersonById(db: CairnDatabase, id: number): { id: number; name: string } | undefined {
  return db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, id)).get();
}

export function findResourceForEgo(
  db: CairnDatabase,
  id: number
): { id: number; name: string; kind: string; sourcePersonId: number | null } | undefined {
  const row = db
    .select({
      id: resources.id,
      name: resources.name,
      kind: resources.kind,
      sourcePersonId: resources.sourcePersonId
    })
    .from(resources)
    .where(eq(resources.id, id))
    .get();
  if (!row) return undefined;
  return { ...row, sourcePersonId: row.sourcePersonId ?? null };
}

export function buildResourceEgoData(
  db: CairnDatabase,
  resourceId: number,
  resource: { id: number; name: string; kind: string; sourcePersonId: number | null }
): ResourceCenterData {
  const neighbors: RawNeighbor[] = [];
  const edges: RawEdge[] = [];

  // Source person
  let sourcePerson: { id: number; name: string } | null = null;
  if (resource.sourcePersonId != null) {
    const personRow = db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(eq(people.id, resource.sourcePersonId))
      .get();
    if (personRow) {
      sourcePerson = personRow;
      neighbors.push({ type: "person", targetId: personRow.id, label: personRow.name, href: `/people/${personRow.id}` });
      edges.push({
        fromType: "resource",
        fromId: resourceId,
        toType: "person",
        toId: personRow.id,
        kind: "source_person",
        firmness: "hard"
      });
    }
  }

  // Resource links
  const linkRows = db
    .select()
    .from(resourceLinks)
    .where(eq(resourceLinks.resourceId, resourceId))
    .all();

  if (linkRows.length > 0) {
    const eventIds = linkRows.filter((l) => l.targetType === "event").map((l) => l.targetId);
    const taskIds = linkRows.filter((l) => l.targetType === "task").map((l) => l.targetId);
    const threadIds = linkRows.filter((l) => l.targetType === "thread").map((l) => l.targetId);

    // Events: fetch with parent thread name for sublabel
    if (eventIds.length > 0) {
      const eventRows = db
        .select({
          id: events.id,
          title: events.title,
          threadId: events.threadId,
          threadName: threads.name
        })
        .from(events)
        .leftJoin(threads, eq(events.threadId, threads.id))
        .where(inArray(events.id, eventIds))
        .all();
      for (const e of eventRows) {
        const link = linkRows.find((l) => l.targetType === "event" && l.targetId === e.id)!;
        neighbors.push({
          type: "event",
          targetId: e.id,
          label: e.title,
          ...(e.threadName ? { sublabel: e.threadName } : {})
        });
        edges.push({
          fromType: "resource",
          fromId: resourceId,
          toType: "event",
          toId: e.id,
          kind: "resource_link",
          firmness: (link.firmness as EgoGraphFirmness) ?? "soft",
          ...(link.reason ? { reason: link.reason } : {})
        });
      }
    }

    // Tasks: fetch with parent thread name
    if (taskIds.length > 0) {
      const taskRows = db
        .select({
          id: tasks.id,
          title: tasks.title,
          threadId: tasks.threadId,
          threadName: threads.name
        })
        .from(tasks)
        .leftJoin(threads, eq(tasks.threadId, threads.id))
        .where(inArray(tasks.id, taskIds))
        .all();
      for (const t of taskRows) {
        const link = linkRows.find((l) => l.targetType === "task" && l.targetId === t.id)!;
        neighbors.push({
          type: "task",
          targetId: t.id,
          label: t.title,
          ...(t.threadName ? { sublabel: t.threadName } : {})
        });
        edges.push({
          fromType: "resource",
          fromId: resourceId,
          toType: "task",
          toId: t.id,
          kind: "resource_link",
          firmness: (link.firmness as EgoGraphFirmness) ?? "soft",
          ...(link.reason ? { reason: link.reason } : {})
        });
      }
    }

    // Threads
    if (threadIds.length > 0) {
      const threadRows = db
        .select({ id: threads.id, name: threads.name })
        .from(threads)
        .where(inArray(threads.id, threadIds))
        .all();
      for (const t of threadRows) {
        const link = linkRows.find((l) => l.targetType === "thread" && l.targetId === t.id)!;
        neighbors.push({
          type: "thread",
          targetId: t.id,
          label: t.name,
          href: `/threads/${t.id}`
        });
        edges.push({
          fromType: "resource",
          fromId: resourceId,
          toType: "thread",
          toId: t.id,
          kind: "resource_link",
          firmness: (link.firmness as EgoGraphFirmness) ?? "soft",
          ...(link.reason ? { reason: link.reason } : {})
        });
      }
    }
  }

  return { resource, sourcePerson, neighbors, edges };
}

export function buildPersonEgoData(
  db: CairnDatabase,
  person: { id: number; name: string }
): PersonCenterData {
  const { id: personId } = person;
  const neighbors: RawNeighbor[] = [];
  const edges: RawEdge[] = [];

  // Resources where source_person_id = personId
  const resourceRows = db
    .select({ id: resources.id, name: resources.name, kind: resources.kind })
    .from(resources)
    .where(eq(resources.sourcePersonId, personId))
    .all();
  for (const r of resourceRows) {
    neighbors.push({ type: "resource", targetId: r.id, label: r.name });
    edges.push({
      fromType: "person",
      fromId: personId,
      toType: "resource",
      toId: r.id,
      kind: "source_person",
      firmness: "hard"
    });
  }

  // Events via event_people, with parent thread name for sublabel
  const epRows = db
    .select({ eventId: eventPeople.eventId })
    .from(eventPeople)
    .where(eq(eventPeople.personId, personId))
    .all();
  const eventIds = epRows.map((r) => r.eventId);
  if (eventIds.length > 0) {
    const eventRows = db
      .select({
        id: events.id,
        title: events.title,
        threadName: threads.name
      })
      .from(events)
      .leftJoin(threads, eq(events.threadId, threads.id))
      .where(inArray(events.id, eventIds))
      .all();
    for (const e of eventRows) {
      neighbors.push({
        type: "event",
        targetId: e.id,
        label: e.title,
        ...(e.threadName ? { sublabel: e.threadName } : {})
      });
      edges.push({
        fromType: "person",
        fromId: personId,
        toType: "event",
        toId: e.id,
        kind: "event_people",
        firmness: "soft"
      });
    }
  }

  return { person, neighbors, edges };
}

