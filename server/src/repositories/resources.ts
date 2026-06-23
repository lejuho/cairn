import { and, asc, eq, inArray, or } from "drizzle-orm";
import type {
  ResourceFirmness,
  ResourceKind,
  ResourceRow,
  ResourceTargetType,
  ThreadResourceFocusData,
  ThreadResourceFocusItem
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, people, resourceLinks, resources, tasks, threads } from "../db/schema.js";

function mapResource(r: {
  id: number;
  name: string;
  kind: string;
  sourcePersonId: number | null;
  note: string | null;
  createdAt: string | null;
}): ResourceRow {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ResourceKind,
    sourcePersonId: r.sourcePersonId ?? null,
    note: r.note ?? null,
    createdAt: r.createdAt ?? null
  };
}

export function createResource(
  db: CairnDatabase,
  input: { name: string; kind: ResourceKind; sourcePersonId?: number | null; note?: string | null }
): ResourceRow {
  const row = db
    .insert(resources)
    .values({
      name: input.name,
      kind: input.kind,
      sourcePersonId: input.sourcePersonId ?? null,
      note: input.note ?? null
    })
    .returning()
    .get();
  return mapResource(row);
}

export function listResources(db: CairnDatabase): ResourceRow[] {
  return db
    .select()
    .from(resources)
    .orderBy(asc(resources.name), asc(resources.id))
    .all()
    .map(mapResource);
}

export function findResourceById(
  db: CairnDatabase,
  id: number
): ResourceRow | undefined {
  const row = db.select().from(resources).where(eq(resources.id, id)).get();
  return row ? mapResource(row) : undefined;
}

export function personExists(db: CairnDatabase, personId: number): boolean {
  return !!db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get();
}

export function eventExists(db: CairnDatabase, id: number): boolean {
  return !!db.select({ id: events.id }).from(events).where(eq(events.id, id)).get();
}

export function taskExists(db: CairnDatabase, id: number): boolean {
  return !!db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get();
}

export function threadExists(db: CairnDatabase, id: number): boolean {
  return !!db.select({ id: threads.id }).from(threads).where(eq(threads.id, id)).get();
}

export function createResourceLinkIdempotent(
  db: CairnDatabase,
  input: {
    resourceId: number;
    targetType: ResourceTargetType;
    targetId: number;
    firmness: ResourceFirmness;
    reason?: string | null;
  }
) {
  return db.transaction((tx) => {
    tx
      .insert(resourceLinks)
      .values({
        resourceId: input.resourceId,
        targetType: input.targetType,
        targetId: input.targetId,
        firmness: input.firmness,
        reason: input.reason ?? null
      })
      .onConflictDoNothing()
      .run();
    const row = tx
      .select()
      .from(resourceLinks)
      .where(
        and(
          eq(resourceLinks.resourceId, input.resourceId),
          eq(resourceLinks.targetType, input.targetType),
          eq(resourceLinks.targetId, input.targetId)
        )
      )
      .get();
    return row!;
  });
}

export function findThreadResourceFocus(
  db: CairnDatabase,
  threadId: number
): ThreadResourceFocusData {
  // Collect all event ids and task ids in the thread.
  const eventRows = db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.threadId, threadId))
    .all();
  const taskRows = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.threadId, threadId))
    .all();
  const eventIds = eventRows.map((r) => r.id);
  const taskIds = taskRows.map((r) => r.id);

  // Find resource_links for: thread itself, its events, its tasks.
  const linkConditions = [
    and(eq(resourceLinks.targetType, "thread"), eq(resourceLinks.targetId, threadId)),
    ...(eventIds.length > 0
      ? [and(eq(resourceLinks.targetType, "event"), inArray(resourceLinks.targetId, eventIds))]
      : []),
    ...(taskIds.length > 0
      ? [and(eq(resourceLinks.targetType, "task"), inArray(resourceLinks.targetId, taskIds))]
      : [])
  ];

  const linkRows =
    linkConditions.length === 1
      ? db.select().from(resourceLinks).where(linkConditions[0]).all()
      : db
          .select()
          .from(resourceLinks)
          .where(or(...linkConditions))
          .all();

  if (linkRows.length === 0) {
    return { threadId, resources: [] };
  }

  // Unique resource ids.
  const resourceIdSet = new Set(linkRows.map((l) => l.resourceId));
  const resourceIdList = [...resourceIdSet];

  const resourceRows = db
    .select()
    .from(resources)
    .where(inArray(resources.id, resourceIdList))
    .all();

  // Collect source person ids.
  const personIdSet = new Set(
    resourceRows.flatMap((r) => (r.sourcePersonId != null ? [r.sourcePersonId] : []))
  );
  const personMap = new Map<number, { id: number; name: string }>();
  if (personIdSet.size > 0) {
    const personRows = db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.id, [...personIdSet]))
      .all();
    for (const p of personRows) {
      personMap.set(p.id, p);
    }
  }

  // Group links by resourceId.
  const linksByResource = new Map<number, typeof linkRows>();
  for (const link of linkRows) {
    const bucket = linksByResource.get(link.resourceId);
    if (bucket) bucket.push(link);
    else linksByResource.set(link.resourceId, [link]);
  }

  const items: ThreadResourceFocusItem[] = resourceRows.map((r) => ({
    resource: mapResource(r),
    sourcePerson: r.sourcePersonId != null ? (personMap.get(r.sourcePersonId) ?? null) : null,
    links: (linksByResource.get(r.id) ?? []).map((l) => ({
      targetType: l.targetType as ResourceTargetType,
      targetId: l.targetId,
      firmness: l.firmness as ResourceFirmness,
      reason: l.reason ?? null
    }))
  }));

  return { threadId, resources: items };
}
