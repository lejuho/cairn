import { and, asc, eq, inArray, or } from "drizzle-orm";
import type {
  PromotionOccurrence,
  ResourceFirmness,
  ResourceKind,
  ResourceLinkRow,
  ResourceRow,
  ResourceTargetType,
  ThreadResourceFocusData,
  ThreadResourceFocusItem
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, people, resourceLinks, resources, tasks, threads } from "../db/schema.js";
import type { CandidateSourceNode, ExistingLinkEntry } from "../services/resource-promotions.js";

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

function mapLink(r: {
  id: number;
  resourceId: number;
  targetType: string;
  targetId: number;
  firmness: string;
  reason: string | null;
  createdAt: string | null;
}): ResourceLinkRow {
  return {
    id: r.id,
    resourceId: r.resourceId,
    targetType: r.targetType as ResourceTargetType,
    targetId: r.targetId,
    firmness: r.firmness as ResourceFirmness,
    reason: r.reason ?? null,
    createdAt: r.createdAt ?? null
  };
}

// Manual one-line preparation (cycle-46 FR-BRF-04). In one transaction:
// find-or-create an `item` resource by exact (name, kind='item'), then
// idempotently link it directly to the event. An existing event link is NOT
// rewritten (firmness/reason preserved) — reusedLink reports it. The newly
// created link uses firmness='hard', reason='직접 추가'.
export function addEventPreparation(
  db: CairnDatabase,
  eventId: number,
  name: string
): { resource: ResourceRow; link: ResourceLinkRow; reusedResource: boolean; reusedLink: boolean } {
  return db.transaction((tx) => {
    let resourceRow = tx
      .select()
      .from(resources)
      .where(and(eq(resources.name, name), eq(resources.kind, "item")))
      .get();
    const reusedResource = !!resourceRow;
    if (!resourceRow) {
      resourceRow = tx
        .insert(resources)
        .values({ name, kind: "item", sourcePersonId: null, note: null })
        .returning()
        .get();
    }
    const resourceId = resourceRow.id;

    const priorLink = tx
      .select()
      .from(resourceLinks)
      .where(
        and(
          eq(resourceLinks.resourceId, resourceId),
          eq(resourceLinks.targetType, "event"),
          eq(resourceLinks.targetId, eventId)
        )
      )
      .get();
    const reusedLink = !!priorLink;

    if (!priorLink) {
      // onConflictDoNothing is a UNIQUE backstop; the pre-check already gates it.
      tx
        .insert(resourceLinks)
        .values({ resourceId, targetType: "event", targetId: eventId, firmness: "hard", reason: "직접 추가" })
        .onConflictDoNothing()
        .run();
    }

    const linkRow = tx
      .select()
      .from(resourceLinks)
      .where(
        and(
          eq(resourceLinks.resourceId, resourceId),
          eq(resourceLinks.targetType, "event"),
          eq(resourceLinks.targetId, eventId)
        )
      )
      .get()!;

    return { resource: mapResource(resourceRow), link: mapLink(linkRow), reusedResource, reusedLink };
  });
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

// --- Preparation brief (cycle-45 FR-BRF-04) ---

// One resource link tagged with the preparation scope that matched it.
export type PreparationScope = "event_direct" | "thread_context" | "previous_event";
export type PreparationLinkEntry = {
  scope: PreparationScope;
  resourceId: number;
  targetType: "event" | "thread";
  targetId: number;
  firmness: ResourceFirmness;
  reason: string | null;
};
export type PreparationLinkData = {
  links: PreparationLinkEntry[];
  resources: ResourceRow[];
  sourcePersons: { id: number; name: string }[];
};

// Read-only: resource links for exactly three explicit targets — the event
// itself (event_direct), its thread (thread_context), and the nearest prior
// same-thread event (previous_event). No broad thread resource-focus dump.
// Returns raw (ungrouped) tagged links + the involved resources + source
// persons; the pure service groups/sorts.
export function findPreparationLinkData(
  db: CairnDatabase,
  eventId: number,
  threadId: number | null,
  previousEventId: number | null
): PreparationLinkData {
  const conditions = [
    and(eq(resourceLinks.targetType, "event"), eq(resourceLinks.targetId, eventId)),
    ...(threadId != null
      ? [and(eq(resourceLinks.targetType, "thread"), eq(resourceLinks.targetId, threadId))]
      : []),
    ...(previousEventId != null
      ? [and(eq(resourceLinks.targetType, "event"), eq(resourceLinks.targetId, previousEventId))]
      : [])
  ];

  const linkRows =
    conditions.length === 1
      ? db.select().from(resourceLinks).where(conditions[0]).all()
      : db.select().from(resourceLinks).where(or(...conditions)).all();

  if (linkRows.length === 0) {
    return { links: [], resources: [], sourcePersons: [] };
  }

  const scopeOf = (targetType: string, targetId: number): PreparationScope | null => {
    if (targetType === "event" && targetId === eventId) return "event_direct";
    if (targetType === "thread" && threadId != null && targetId === threadId) return "thread_context";
    if (targetType === "event" && previousEventId != null && targetId === previousEventId) return "previous_event";
    return null;
  };

  const links: PreparationLinkEntry[] = [];
  for (const l of linkRows) {
    const scope = scopeOf(l.targetType, l.targetId);
    if (scope == null) continue;
    links.push({
      scope,
      resourceId: l.resourceId,
      targetType: l.targetType as "event" | "thread",
      targetId: l.targetId,
      firmness: l.firmness as ResourceFirmness,
      reason: l.reason ?? null
    });
  }

  const resourceIdList = [...new Set(links.map((l) => l.resourceId))];
  const resourceRows = db
    .select()
    .from(resources)
    .where(inArray(resources.id, resourceIdList))
    .all()
    .map(mapResource);

  const personIdSet = new Set(
    resourceRows.flatMap((r) => (r.sourcePersonId != null ? [r.sourcePersonId] : []))
  );
  const sourcePersons =
    personIdSet.size > 0
      ? db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, [...personIdSet]))
          .all()
      : [];

  return { links, resources: resourceRows, sourcePersons };
}

// --- Promotion suggestion sources ---

// Returns candidate source nodes for extraction.
// If threadId is provided, scopes to that thread's events/tasks/thread itself.
export function findCandidateSources(
  db: CairnDatabase,
  threadId?: number
): CandidateSourceNode[] {
  const nodes: CandidateSourceNode[] = [];

  if (threadId != null) {
    // Thread itself
    const threadRow = db
      .select({ id: threads.id, name: threads.name, goal: threads.goal })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get();
    if (threadRow) {
      nodes.push({
        targetType: "thread",
        targetId: threadRow.id,
        fields: [threadRow.name ?? "", threadRow.goal ?? ""]
      });
    }

    // Thread events
    const eventRows = db
      .select({ id: events.id, title: events.title, location: events.location })
      .from(events)
      .where(eq(events.threadId, threadId))
      .all();
    for (const e of eventRows) {
      nodes.push({
        targetType: "event",
        targetId: e.id,
        fields: [e.title ?? "", e.location ?? ""]
      });
    }

    // Thread tasks
    const taskRows = db
      .select({ id: tasks.id, title: tasks.title, context: tasks.context })
      .from(tasks)
      .where(eq(tasks.threadId, threadId))
      .all();
    for (const t of taskRows) {
      nodes.push({
        targetType: "task",
        targetId: t.id,
        fields: [t.title ?? "", t.context ?? ""]
      });
    }
  } else {
    // All threads
    const threadRows = db
      .select({ id: threads.id, name: threads.name, goal: threads.goal })
      .from(threads)
      .all();
    for (const t of threadRows) {
      nodes.push({
        targetType: "thread",
        targetId: t.id,
        fields: [t.name ?? "", t.goal ?? ""]
      });
    }

    // All events
    const eventRows = db
      .select({ id: events.id, title: events.title, location: events.location })
      .from(events)
      .all();
    for (const e of eventRows) {
      nodes.push({
        targetType: "event",
        targetId: e.id,
        fields: [e.title ?? "", e.location ?? ""]
      });
    }

    // All tasks
    const taskRows = db
      .select({ id: tasks.id, title: tasks.title, context: tasks.context })
      .from(tasks)
      .all();
    for (const t of taskRows) {
      nodes.push({
        targetType: "task",
        targetId: t.id,
        fields: [t.title ?? "", t.context ?? ""]
      });
    }
  }

  return nodes;
}

// Returns all resource_links joined to resource name+kind for suppression.
export function findAllResourceLinksForSuppression(db: CairnDatabase): ExistingLinkEntry[] {
  const rows = db
    .select({
      resourceName: resources.name,
      resourceKind: resources.kind,
      targetType: resourceLinks.targetType,
      targetId: resourceLinks.targetId
    })
    .from(resourceLinks)
    .innerJoin(resources, eq(resourceLinks.resourceId, resources.id))
    .all();
  return rows.map((r) => ({
    resourceName: r.resourceName,
    resourceKind: r.resourceKind as ResourceKind,
    targetType: r.targetType as ResourceTargetType,
    targetId: r.targetId
  }));
}

// Find an existing resource by exact name+kind (for reuse on approval).
export function findResourceByNameAndKind(
  db: CairnDatabase,
  name: string,
  kind: ResourceKind
): ResourceRow | undefined {
  const row = db
    .select()
    .from(resources)
    .where(and(eq(resources.name, name), eq(resources.kind, kind)))
    .get();
  return row ? mapResource(row) : undefined;
}

// Approve promotion: find-or-create resource, then idempotently create links.
// Runs entirely inside a transaction with re-validated stale check.
export function approvePromotion(
  db: CairnDatabase,
  input: {
    name: string;
    kind: ResourceKind;
    occurrences: PromotionOccurrence[];
    sourcePersonId?: number | null;
    note?: string | null;
  }
): { resource: ResourceRow; links: { targetType: ResourceTargetType; targetId: number }[]; reusedResource: boolean } {
  return db.transaction((tx) => {
    // Find-or-create resource.
    let existing = tx
      .select()
      .from(resources)
      .where(and(eq(resources.name, input.name), eq(resources.kind, input.kind)))
      .get();

    const reusedResource = !!existing;

    if (!existing) {
      existing = tx
        .insert(resources)
        .values({
          name: input.name,
          kind: input.kind,
          sourcePersonId: input.sourcePersonId ?? null,
          note: input.note ?? null
        })
        .returning()
        .get();
    }

    const resourceId = existing.id;

    // Idempotently create links for each occurrence.
    for (const occ of input.occurrences) {
      const reason = `repeated mention in ${occ.targetType} ${occ.targetId}`;
      tx
        .insert(resourceLinks)
        .values({
          resourceId,
          targetType: occ.targetType,
          targetId: occ.targetId,
          firmness: "tentative",
          reason
        })
        .onConflictDoNothing()
        .run();
    }

    return {
      resource: mapResource(existing),
      links: input.occurrences.map((o) => ({ targetType: o.targetType, targetId: o.targetId })),
      reusedResource
    };
  });
}
