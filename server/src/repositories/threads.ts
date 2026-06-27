import { alias } from "drizzle-orm/sqlite-core";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type {
  CreateThreadRequest,
  DomainFilter,
  EventRow,
  PatchThreadResumeRequest,
  TaskRow,
  ThreadDomain,
  ThreadLinkFirmness,
  ThreadLinkRow,
  ThreadLinkView,
  ThreadResumeData,
  ThreadRow
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { ThreadLinkRow as TransitionLinkRow } from "../services/context-switch.js";
import { events, tasks, threadLinks, threads } from "../db/schema.js";

// Stable `ThreadRow` projection (cycle-56). The threads table also holds resume/
// CV columns (resume_relevant/star_*/skills_tags); those are intentionally NOT
// part of ThreadRow and are read separately via `findThreadResume`. Selecting
// only these columns keeps GET /api/threads and thread detail from leaking raw
// resume storage outside the explicit `resume: ThreadResumeData` contract.
export const THREAD_ROW_COLUMNS = {
  id: threads.id,
  name: threads.name,
  kind: threads.kind,
  goal: threads.goal,
  definitionOfDone: threads.definitionOfDone,
  deadline: threads.deadline,
  status: threads.status,
  domain: threads.domain,
  createdAt: threads.createdAt
} as const;

export function createThread(db: CairnDatabase, input: CreateThreadRequest): ThreadRow {
  const [row] = db
    .insert(threads)
    .values({
      name: input.name,
      kind: input.kind ?? null,
      goal: input.goal ?? null,
      deadline: input.deadline ?? null,
      status: "active",
      // Domain default (cycle-67 FR-DOM-01): omitted create → `personal`.
      domain: input.domain ?? "personal"
    })
    .returning(THREAD_ROW_COLUMNS)
    .all();
  return row as ThreadRow;
}

// Domain-filtered thread list (cycle-67). `all`/undefined preserves the existing
// createdAt-desc/id-desc ordering across every thread; personal|work narrows it.
export function listThreads(db: CairnDatabase, domain?: DomainFilter): ThreadRow[] {
  const query = db.select(THREAD_ROW_COLUMNS).from(threads);
  const filtered =
    domain === "personal" || domain === "work" ? query.where(eq(threads.domain, domain)) : query;
  return filtered.orderBy(desc(threads.createdAt), desc(threads.id)).all() as ThreadRow[];
}

// Read-only set of thread ids in a given domain (cycle-67). Used by the Today
// route to filter thread-linked items before surface/feasibility construction.
export function findThreadIdsByDomain(db: CairnDatabase, domain: ThreadDomain): Set<number> {
  const rows = db.select({ id: threads.id }).from(threads).where(eq(threads.domain, domain)).all();
  return new Set(rows.map((r) => r.id));
}

export function findThreadById(db: CairnDatabase, id: number): ThreadRow | null {
  const row = db.select(THREAD_ROW_COLUMNS).from(threads).where(eq(threads.id, id)).get();
  return row ? (row as ThreadRow) : null;
}

// Resume / CV STAR persistence (cycle-56 FR-CV-01/03). The 5 resume columns are
// not on ThreadRow, so resume reads/writes use dedicated helpers.

// Fail-open: malformed/legacy skills_tags JSON yields [] and never fabricates.
export function parseSkillsTags(raw: string | null): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed as string[];
    return [];
  } catch {
    return [];
  }
}

export function findThreadResume(db: CairnDatabase, id: number): ThreadResumeData | null {
  const row = db
    .select({
      resumeRelevant: threads.resumeRelevant,
      starSituation: threads.starSituation,
      starAction: threads.starAction,
      starResult: threads.starResult,
      skillsTags: threads.skillsTags
    })
    .from(threads)
    .where(eq(threads.id, id))
    .get();
  if (!row) return null;
  return {
    resumeRelevant: row.resumeRelevant === 1,
    starSituation: row.starSituation ?? null,
    starAction: row.starAction ?? null,
    starResult: row.starResult ?? null,
    skillsTags: parseSkillsTags(row.skillsTags ?? null)
  };
}

function normalizeText(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Updates ONLY the resume columns present in the patch; unspecified columns are
// left untouched. Text trimmed (blank→null); skillsTags stored as a JSON array.
export function updateThreadResume(db: CairnDatabase, id: number, patch: PatchThreadResumeRequest): ThreadResumeData {
  const set: Partial<typeof threads.$inferInsert> = {};
  if ("resumeRelevant" in patch) set.resumeRelevant = patch.resumeRelevant ? 1 : 0;
  if ("starSituation" in patch) set.starSituation = normalizeText(patch.starSituation ?? null);
  if ("starAction" in patch) set.starAction = normalizeText(patch.starAction ?? null);
  if ("starResult" in patch) set.starResult = normalizeText(patch.starResult ?? null);
  if ("skillsTags" in patch) set.skillsTags = JSON.stringify(patch.skillsTags ?? []);
  db.update(threads).set(set).where(eq(threads.id, id)).run();
  return findThreadResume(db, id)!;
}

export function findThreadsByIds(db: CairnDatabase, ids: number[]): ThreadRow[] {
  if (ids.length === 0) return [];
  return db
    .select(THREAD_ROW_COLUMNS)
    .from(threads)
    .all()
    .filter((r) => ids.includes(r.id)) as ThreadRow[];
}

// Read-only: thread_links where BOTH endpoints are in `threadIds` (intra-day
// scope only, no global traversal). Used by the context-switch service.
export function findThreadLinksAmong(db: CairnDatabase, threadIds: number[]): TransitionLinkRow[] {
  if (threadIds.length < 2) return [];
  return db
    .select({
      id: threadLinks.id,
      fromThread: threadLinks.fromThread,
      toThread: threadLinks.toThread,
      kind: threadLinks.kind,
      firmness: threadLinks.firmness
    })
    .from(threadLinks)
    .where(and(inArray(threadLinks.fromThread, threadIds), inArray(threadLinks.toThread, threadIds)))
    .all()
    .flatMap((r) => {
      if (r.fromThread == null || r.toThread == null || r.kind == null || r.firmness == null) return [];
      return [{
        id: r.id,
        fromThread: r.fromThread,
        toThread: r.toThread,
        kind: r.kind as TransitionLinkRow["kind"],
        firmness: r.firmness as TransitionLinkRow["firmness"]
      }];
    });
}

export function findEventsByThreadId(db: CairnDatabase, threadId: number): EventRow[] {
  return db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .all()
    .sort((a, b) => {
      if (a.start == null && b.start == null) return 0;
      if (a.start == null) return 1;
      if (b.start == null) return -1;
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    }) as EventRow[];
}

export function findTasksByThreadId(db: CairnDatabase, threadId: number): TaskRow[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.threadId, threadId))
    .orderBy(asc(tasks.createdAt))
    .all() as TaskRow[];
}

// Missing-node evidence reads (cycle-54 FR-THR-08). All read-only.
export type ThreadNodeTitleRow = { threadId: number; title: string | null; status: string | null };

// Other completed threads with the exact same kind, excluding the current id.
export function findCompletedThreadsByKind(db: CairnDatabase, kind: string, excludeId: number): ThreadRow[] {
  return db
    .select(THREAD_ROW_COLUMNS)
    .from(threads)
    .where(and(eq(threads.status, "done"), eq(threads.kind, kind), ne(threads.id, excludeId)))
    .orderBy(asc(threads.id))
    .all() as ThreadRow[];
}

export function findEventTitlesByThreadIds(db: CairnDatabase, threadIds: number[]): ThreadNodeTitleRow[] {
  if (threadIds.length === 0) return [];
  return db
    .select({ threadId: events.threadId, title: events.title, status: events.status })
    .from(events)
    .where(inArray(events.threadId, threadIds))
    .orderBy(asc(events.id))
    .all() as ThreadNodeTitleRow[];
}

export function findTaskTitlesByThreadIds(db: CairnDatabase, threadIds: number[]): ThreadNodeTitleRow[] {
  if (threadIds.length === 0) return [];
  return db
    .select({ threadId: tasks.threadId, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.threadId, threadIds))
    .orderBy(asc(tasks.id))
    .all() as ThreadNodeTitleRow[];
}

// Returns incoming and outgoing link counts per thread as a single-pass aggregate.
export function countLinksForAllThreads(
  db: CairnDatabase
): Map<number, { incoming: number; outgoing: number }> {
  const result = new Map<number, { incoming: number; outgoing: number }>();
  const ensure = (id: number) => {
    if (!result.has(id)) result.set(id, { incoming: 0, outgoing: 0 });
    return result.get(id)!;
  };

  const outgoing = db
    .select({ tid: threadLinks.fromThread, cnt: sql<number>`count(*)` })
    .from(threadLinks)
    .groupBy(threadLinks.fromThread)
    .all();
  for (const r of outgoing) {
    if (r.tid != null) ensure(r.tid).outgoing = r.cnt;
  }

  const incoming = db
    .select({ tid: threadLinks.toThread, cnt: sql<number>`count(*)` })
    .from(threadLinks)
    .groupBy(threadLinks.toThread)
    .all();
  for (const r of incoming) {
    if (r.tid != null) ensure(r.tid).incoming = r.cnt;
  }

  return result;
}

// Returns all contains edges as an adjacency map (parent → children) for cycle detection.
export function findContainsAdjacency(db: CairnDatabase): Map<number, number[]> {
  const rows = db
    .select({ from: threadLinks.fromThread, to: threadLinks.toThread })
    .from(threadLinks)
    .where(eq(threadLinks.kind, "contains"))
    .all();
  const map = new Map<number, number[]>();
  for (const r of rows) {
    if (r.from == null || r.to == null) continue;
    const children = map.get(r.from) ?? [];
    children.push(r.to);
    map.set(r.from, children);
  }
  return map;
}

// Returns a link with peer thread names for rendering.
type RawLinkJoin = {
  id: number;
  fromThreadId: number | null;
  fromThreadName: string | null;
  toThreadId: number | null;
  toThreadName: string | null;
  kind: string | null;
  firmness: string;
  createdAt: string | null;
};

function rawToView(r: RawLinkJoin): ThreadLinkView | null {
  if (
    r.fromThreadId == null || r.fromThreadName == null ||
    r.toThreadId == null || r.toThreadName == null ||
    r.kind == null
  ) return null;
  return {
    id: r.id,
    fromThread: { id: r.fromThreadId, name: r.fromThreadName },
    toThread: { id: r.toThreadId, name: r.toThreadName },
    kind: r.kind as ThreadLinkView["kind"],
    firmness: r.firmness as ThreadLinkFirmness,
    createdAt: r.createdAt
  };
}

export function findLinksWithPeers(db: CairnDatabase, threadId: number): {
  incoming: ThreadLinkView[];
  outgoing: ThreadLinkView[];
} {
  const ft = alias(threads, "ft");
  const tt = alias(threads, "tt");

  const rows = db
    .select({
      id: threadLinks.id,
      fromThreadId: threadLinks.fromThread,
      fromThreadName: ft.name,
      toThreadId: threadLinks.toThread,
      toThreadName: tt.name,
      kind: threadLinks.kind,
      firmness: threadLinks.firmness,
      createdAt: threadLinks.createdAt
    })
    .from(threadLinks)
    .leftJoin(ft, eq(threadLinks.fromThread, ft.id))
    .leftJoin(tt, eq(threadLinks.toThread, tt.id))
    .where(or(eq(threadLinks.fromThread, threadId), eq(threadLinks.toThread, threadId)))
    .all() as RawLinkJoin[];

  const incoming: ThreadLinkView[] = [];
  const outgoing: ThreadLinkView[] = [];
  for (const r of rows) {
    const view = rawToView(r);
    if (!view) continue;
    if (r.toThreadId === threadId) incoming.push(view);
    else outgoing.push(view);
  }
  return { incoming, outgoing };
}

export function findDuplicateLink(
  db: CairnDatabase,
  fromThread: number,
  toThread: number,
  kind: string
): ThreadLinkRow | null {
  const row = db
    .select()
    .from(threadLinks)
    .where(
      sql`${threadLinks.fromThread} = ${fromThread} AND ${threadLinks.toThread} = ${toThread} AND ${threadLinks.kind} = ${kind}`
    )
    .get();
  return row ? (row as unknown as ThreadLinkRow) : null;
}

export function insertLink(
  db: CairnDatabase,
  fromThread: number,
  toThread: number,
  kind: string,
  firmness: string
): ThreadLinkRow {
  const [row] = db
    .insert(threadLinks)
    .values({ fromThread, toThread, kind, firmness })
    .returning()
    .all();
  return row as unknown as ThreadLinkRow;
}

export function deleteLinkById(
  db: CairnDatabase,
  linkId: number,
  fromThreadId: number
): boolean {
  const existing = db
    .select()
    .from(threadLinks)
    .where(sql`${threadLinks.id} = ${linkId} AND ${threadLinks.fromThread} = ${fromThreadId}`)
    .get();
  if (!existing) return false;
  db.delete(threadLinks).where(eq(threadLinks.id, linkId)).run();
  return true;
}

// Rollup A helpers — hard contains adjacency with link ids for traversal.
export type ContainsEdge = { relationId: number; parentId: number; childId: number };

export function findHardContainsEdges(db: CairnDatabase): ContainsEdge[] {
  const rows = db
    .select({
      id: threadLinks.id,
      from: threadLinks.fromThread,
      to: threadLinks.toThread
    })
    .from(threadLinks)
    .where(sql`${threadLinks.kind} = 'contains' AND ${threadLinks.firmness} = 'hard'`)
    .all();
  const edges: ContainsEdge[] = [];
  for (const r of rows) {
    if (r.from == null || r.to == null) continue;
    edges.push({ relationId: r.id, parentId: r.from, childId: r.to });
  }
  return edges;
}

// Minimal event rows for rollup: id, threadId, start, end, status, plus the
// cancel cost columns needed for paid-cost rollup (cycle-60 FR-THR-10). The
// cancel fields match the shared PaidCostEventInput shape so the rollup service
// can aggregate them directly.
export type EventSlim = {
  id: number;
  threadId: number;
  start: string | null;
  end: string | null;
  status: string | null;
  cancelMoney: number | null;
  cancelSocial: number | null;
  cancelEffort: string | null;
  cancelWindow: string | null;
};

export function findEventsSlimByThreadIds(db: CairnDatabase, threadIds: number[]): EventSlim[] {
  if (threadIds.length === 0) return [];
  return db
    .select({
      id: events.id,
      threadId: events.threadId,
      start: events.start,
      end: events.end,
      status: events.status,
      cancelMoney: events.cancelMoney,
      cancelSocial: events.cancelSocial,
      cancelEffort: events.cancelEffort,
      cancelWindow: events.cancelWindow
    })
    .from(events)
    .all()
    .filter((r) => r.threadId != null && threadIds.includes(r.threadId as number)) as EventSlim[];
}

// Minimal task rows for rollup: id, threadId, status.
export type TaskSlim = { id: number; threadId: number; status: string | null };

export function findTasksSlimByThreadIds(db: CairnDatabase, threadIds: number[]): TaskSlim[] {
  if (threadIds.length === 0) return [];
  return db
    .select({ id: tasks.id, threadId: tasks.threadId, status: tasks.status })
    .from(tasks)
    .all()
    .filter((r) => r.threadId != null && threadIds.includes(r.threadId as number)) as TaskSlim[];
}

// Minimal thread rows for rollup: id, name.
export function findThreadNamesByIds(db: CairnDatabase, ids: number[]): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = db.select({ id: threads.id, name: threads.name }).from(threads).all();
  const map = new Map<number, string>();
  for (const r of rows) {
    if (ids.includes(r.id)) map.set(r.id, r.name);
  }
  return map;
}

// Used for hard-parent conflict check: does toThread already have a hard contains parent?
export function findHardContainsParent(
  db: CairnDatabase,
  toThreadId: number,
  excludeFromThread?: number
): ThreadLinkRow | null {
  const rows = db
    .select()
    .from(threadLinks)
    .where(
      sql`${threadLinks.toThread} = ${toThreadId} AND ${threadLinks.kind} = 'contains' AND ${threadLinks.firmness} = 'hard'`
    )
    .all() as ThreadLinkRow[];
  return rows.find((r) => r.fromThread !== excludeFromThread) ?? null;
}
