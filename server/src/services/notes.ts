import { and, asc, desc, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import type {
  CreateNoteRequest,
  NoteItemInput,
  NoteItemView,
  NoteLinkInput,
  NoteListData,
  NoteListQuery,
  NoteRelatedTarget,
  NoteTargetType,
  NoteTargetView,
  NoteView,
  PatchNoteItemRequest,
  PatchNoteRequest
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, noteItems, noteLinks, notes, tasks, threads } from "../db/schema.js";

type NoteRow = typeof notes.$inferSelect;
type ItemRow = typeof noteItems.$inferSelect;

export type NoteResult =
  | { ok: true; note: NoteView }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION_ERROR"; message: string };

function timeZone(): string {
  return process.env.CAIRN_TIME_ZONE?.trim() || "Asia/Seoul";
}

// RFC3339 시각이나 YYYY-MM-DD 를 로컬 날짜(YYYY-MM-DD)로. 읽을 수 없으면 null.
export function localDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function targetKey(type: string, id: number): string {
  return `${type}:${id}`;
}

function eventTarget(row: { id: number; title: string; start: string | null; status: string | null }): NoteTargetView {
  return { targetType: "event", targetId: row.id, label: row.title, when: row.start, status: row.status, exists: true };
}

function taskTarget(row: { id: number; title: string; due: string | null; status: string | null }): NoteTargetView {
  return { targetType: "task", targetId: row.id, label: row.title, when: row.due, status: row.status, exists: true };
}

function threadTarget(row: { id: number; name: string; deadline: string | null; status: string | null }): NoteTargetView {
  return { targetType: "thread", targetId: row.id, label: row.name, when: row.deadline, status: row.status, exists: true };
}

const EVENT_COLS = { id: events.id, title: events.title, start: events.start, status: events.status, location: events.location };
const TASK_COLS = { id: tasks.id, title: tasks.title, due: tasks.due, status: tasks.status };
const THREAD_COLS = { id: threads.id, name: threads.name, deadline: threads.deadline, status: threads.status };

function resolveTargets(db: CairnDatabase, refs: Array<{ targetType: string; targetId: number }>): Map<string, NoteTargetView> {
  const ids: Record<NoteTargetType, number[]> = { event: [], task: [], thread: [] };
  for (const ref of refs) {
    const list = ids[ref.targetType as NoteTargetType];
    if (list && !list.includes(ref.targetId)) list.push(ref.targetId);
  }
  const out = new Map<string, NoteTargetView>();
  if (ids.event.length > 0) {
    for (const row of db.select(EVENT_COLS).from(events).where(inArray(events.id, ids.event)).all()) out.set(targetKey("event", row.id), eventTarget(row));
  }
  if (ids.task.length > 0) {
    for (const row of db.select(TASK_COLS).from(tasks).where(inArray(tasks.id, ids.task)).all()) out.set(targetKey("task", row.id), taskTarget(row));
  }
  if (ids.thread.length > 0) {
    for (const row of db.select(THREAD_COLS).from(threads).where(inArray(threads.id, ids.thread)).all()) out.set(targetKey("thread", row.id), threadTarget(row));
  }
  return out;
}

function missingTarget(link: { targetType: string; targetId: number }): NoteTargetView {
  return { targetType: link.targetType as NoteTargetType, targetId: link.targetId, label: "(지워진 대상)", when: null, status: null, exists: false };
}

function itemView(row: ItemRow): NoteItemView {
  return { id: row.id, text: row.text, done: row.done === 1, doneAt: row.doneAt, position: row.position };
}

function buildViews(db: CairnDatabase, rows: NoteRow[]): NoteView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const items = db.select().from(noteItems).where(inArray(noteItems.noteId, ids)).orderBy(asc(noteItems.position), asc(noteItems.id)).all();
  const links = db.select().from(noteLinks).where(inArray(noteLinks.noteId, ids)).orderBy(asc(noteLinks.id)).all();
  const targets = resolveTargets(db, links);
  const itemsByNote = new Map<number, NoteItemView[]>();
  for (const item of items) {
    const list = itemsByNote.get(item.noteId) ?? [];
    list.push(itemView(item));
    itemsByNote.set(item.noteId, list);
  }
  const linksByNote = new Map<number, NoteTargetView[]>();
  for (const link of links) {
    const list = linksByNote.get(link.noteId) ?? [];
    list.push(targets.get(targetKey(link.targetType, link.targetId)) ?? missingTarget(link));
    linksByNote.set(link.noteId, list);
  }
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as NoteView["kind"],
    title: row.title,
    body: row.body,
    noteDate: row.noteDate,
    pinned: row.pinned === 1,
    remoteVisible: row.remoteVisible === 1,
    items: itemsByNote.get(row.id) ?? [],
    links: linksByNote.get(row.id) ?? [],
    addedBy: row.addedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt
  }));
}

export function getNote(db: CairnDatabase, id: number): NoteView | null {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  return row ? buildViews(db, [row])[0] ?? null : null;
}

function dedupeLinks(links: NoteLinkInput[]): NoteLinkInput[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = targetKey(l.targetType, l.targetId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 없는 대상에 붙이는 건 막는다 (나중에 대상이 지워지는 것과는 다르다).
function findMissingLink(db: CairnDatabase, links: NoteLinkInput[]): NoteLinkInput | null {
  const found = resolveTargets(db, links);
  return links.find((l) => !found.has(targetKey(l.targetType, l.targetId))) ?? null;
}

function nullIfBlank(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null;
}

export function createNote(db: CairnDatabase, req: CreateNoteRequest, now: Date = new Date()): NoteResult {
  const links = dedupeLinks(req.links ?? []);
  const missing = findMissingLink(db, links);
  if (missing) return { ok: false, code: "NOT_FOUND", message: `${missing.targetType} ${missing.targetId} not found` };
  const stamp = now.toISOString();
  const id = db.transaction((tx) => {
    const [row] = tx
      .insert(notes)
      .values({
        kind: req.kind,
        title: nullIfBlank(req.title?.trim()),
        body: nullIfBlank(req.body),
        noteDate: req.noteDate ?? null,
        pinned: req.pinned ? 1 : 0,
        remoteVisible: req.remoteVisible ? 1 : 0,
        addedBy: req.addedBy ?? null,
        createdAt: stamp,
        updatedAt: stamp
      })
      .returning({ id: notes.id })
      .all();
    const noteId = row!.id;
    (req.items ?? []).forEach((item, position) => {
      tx.insert(noteItems).values({ noteId, text: item.text, done: item.done ? 1 : 0, position, doneAt: item.done ? stamp : null }).run();
    });
    for (const link of links) {
      tx.insert(noteLinks).values({ noteId, targetType: link.targetType, targetId: link.targetId, createdAt: stamp }).run();
    }
    return noteId;
  });
  return { ok: true, note: getNote(db, id)! };
}

function replaceItems(tx: CairnDatabase, noteId: number, next: NoteItemInput[], stamp: string): string | null {
  const existing = tx.select().from(noteItems).where(eq(noteItems.noteId, noteId)).all();
  const byId = new Map(existing.map((row) => [row.id, row]));
  const unknown = next.find((item) => item.id !== undefined && !byId.has(item.id));
  if (unknown) return `item ${unknown.id} does not belong to note ${noteId}`;
  const keep = new Set(next.flatMap((item) => (item.id !== undefined ? [item.id] : [])));
  for (const row of existing) {
    if (!keep.has(row.id)) tx.delete(noteItems).where(eq(noteItems.id, row.id)).run();
  }
  next.forEach((item, position) => {
    const prev = item.id !== undefined ? byId.get(item.id) : undefined;
    if (prev) {
      const done = item.done ?? prev.done === 1;
      const doneAt = !done ? null : prev.done === 1 ? prev.doneAt : stamp;
      tx.update(noteItems).set({ text: item.text, done: done ? 1 : 0, position, doneAt }).where(eq(noteItems.id, prev.id)).run();
    } else {
      tx.insert(noteItems).values({ noteId, text: item.text, done: item.done ? 1 : 0, position, doneAt: item.done ? stamp : null }).run();
    }
  });
  return null;
}

class NoteAbort extends Error {}

export function updateNote(db: CairnDatabase, id: number, req: PatchNoteRequest, now: Date = new Date()): NoteResult {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) return { ok: false, code: "NOT_FOUND", message: `note ${id} not found` };
  const links = req.links ? dedupeLinks(req.links) : null;
  if (links) {
    const missing = findMissingLink(db, links);
    if (missing) return { ok: false, code: "NOT_FOUND", message: `${missing.targetType} ${missing.targetId} not found` };
  }
  const stamp = now.toISOString();
  try {
    db.transaction((tx) => {
      const patch: Partial<typeof notes.$inferInsert> = { updatedAt: stamp };
      if (req.kind !== undefined) patch.kind = req.kind;
      if (req.title !== undefined) patch.title = nullIfBlank(req.title?.trim());
      if (req.body !== undefined) patch.body = nullIfBlank(req.body);
      if (req.noteDate !== undefined) patch.noteDate = req.noteDate;
      if (req.pinned !== undefined) patch.pinned = req.pinned ? 1 : 0;
      if (req.remoteVisible !== undefined) patch.remoteVisible = req.remoteVisible ? 1 : 0;
      if (req.archived !== undefined) patch.archivedAt = req.archived ? row.archivedAt ?? stamp : null;
      tx.update(notes).set(patch).where(eq(notes.id, id)).run();
      if (req.items) {
        const problem = replaceItems(tx as unknown as CairnDatabase, id, req.items, stamp);
        if (problem) throw new NoteAbort(problem);
      }
      if (links) {
        tx.delete(noteLinks).where(eq(noteLinks.noteId, id)).run();
        for (const link of links) {
          tx.insert(noteLinks).values({ noteId: id, targetType: link.targetType, targetId: link.targetId, createdAt: stamp }).run();
        }
      }
    });
  } catch (err) {
    if (err instanceof NoteAbort) return { ok: false, code: "VALIDATION_ERROR", message: err.message };
    throw err;
  }
  return { ok: true, note: getNote(db, id)! };
}

export function deleteNote(db: CairnDatabase, id: number): boolean {
  if (!db.select({ id: notes.id }).from(notes).where(eq(notes.id, id)).get()) return false;
  db.transaction((tx) => {
    tx.delete(noteItems).where(eq(noteItems.noteId, id)).run();
    tx.delete(noteLinks).where(eq(noteLinks.noteId, id)).run();
    tx.delete(notes).where(eq(notes.id, id)).run();
  });
  return true;
}

export function addNoteItem(db: CairnDatabase, noteId: number, text: string, now: Date = new Date()): NoteResult {
  if (!db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get()) {
    return { ok: false, code: "NOT_FOUND", message: `note ${noteId} not found` };
  }
  const last = db.select({ max: sql<number | null>`max(${noteItems.position})` }).from(noteItems).where(eq(noteItems.noteId, noteId)).get();
  db.transaction((tx) => {
    tx.insert(noteItems).values({ noteId, text, done: 0, position: (last?.max ?? -1) + 1 }).run();
    // 항목이 생기면 체크리스트로 본다.
    tx.update(notes).set({ kind: "checklist", updatedAt: now.toISOString() }).where(eq(notes.id, noteId)).run();
  });
  return { ok: true, note: getNote(db, noteId)! };
}

export function updateNoteItem(db: CairnDatabase, noteId: number, itemId: number, req: PatchNoteItemRequest, now: Date = new Date()): NoteResult {
  const item = db.select().from(noteItems).where(and(eq(noteItems.id, itemId), eq(noteItems.noteId, noteId))).get();
  if (!item) return { ok: false, code: "NOT_FOUND", message: `item ${itemId} not found on note ${noteId}` };
  const stamp = now.toISOString();
  const patch: Partial<typeof noteItems.$inferInsert> = {};
  if (req.text !== undefined) patch.text = req.text;
  if (req.done !== undefined) {
    patch.done = req.done ? 1 : 0;
    patch.doneAt = !req.done ? null : item.done === 1 ? item.doneAt : stamp;
  }
  db.transaction((tx) => {
    tx.update(noteItems).set(patch).where(eq(noteItems.id, itemId)).run();
    tx.update(notes).set({ updatedAt: stamp }).where(eq(notes.id, noteId)).run();
  });
  return { ok: true, note: getNote(db, noteId)! };
}

function terms(q: string | undefined): string[] {
  return (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(note: NoteView): string {
  return [note.title, note.body, ...note.items.map((i) => i.text), ...note.links.map((l) => l.label)]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

// 메모가 걸쳐 있는 날짜들: 메모 날짜, 붙은 일정·할 일·스레드의 날짜. 아무것도 없으면 쓴 날.
function noteDates(note: NoteView): string[] {
  const dates = [note.noteDate, ...note.links.map((l) => localDateOf(l.when))].filter((d): d is string => Boolean(d));
  if (dates.length > 0) return dates;
  const created = localDateOf(note.createdAt);
  return created ? [created] : [];
}

// 구간 안의 날짜별 메모 수. 한 메모가 여러 날에 걸려 있으면(메모 날짜 + 붙은 일정 날짜) 각 날에 한 번씩 센다.
export function countNotesByDay(db: CairnDatabase, from: string, to: string, opts: { remoteOnly?: boolean } = {}): Record<string, number> {
  const rows = db.select().from(notes).where(and(isNull(notes.archivedAt), opts.remoteOnly ? eq(notes.remoteVisible, 1) : undefined)).all();
  const counts: Record<string, number> = {};
  for (const note of buildViews(db, rows)) {
    for (const day of new Set(noteDates(note))) {
      if (day >= from && day <= to) counts[day] = (counts[day] ?? 0) + 1;
    }
  }
  return counts;
}

function sortKey(note: NoteView): string {
  return note.noteDate ?? localDateOf(note.createdAt) ?? "";
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function likeAll(column: SQLWrapper, words: string[]) {
  return and(...words.map((w) => sql`${column} like ${`%${escapeLike(w)}%`} escape '\\'`));
}

function noteCounts(db: CairnDatabase): Map<string, number> {
  const rows = db
    .select({ targetType: noteLinks.targetType, targetId: noteLinks.targetId, count: sql<number>`count(*)` })
    .from(noteLinks)
    .innerJoin(notes, eq(notes.id, noteLinks.noteId))
    .where(isNull(notes.archivedAt))
    .groupBy(noteLinks.targetType, noteLinks.targetId)
    .all();
  return new Map(rows.map((r) => [targetKey(r.targetType, r.targetId), Number(r.count)]));
}

// 이름에 검색어가 걸린 일정·할 일·스레드. 메모가 붙지 않은 과거 일정도 여기서 찾는다.
function findRelated(db: CairnDatabase, words: string[], limit: number): NoteRelatedTarget[] {
  if (words.length === 0) return [];
  const counts = noteCounts(db);
  const withCount = (t: NoteTargetView, location: string | null): NoteRelatedTarget => ({
    ...t,
    location,
    noteCount: counts.get(targetKey(t.targetType, t.targetId)) ?? 0
  });
  const eventRows = db.select(EVENT_COLS).from(events).where(likeAll(events.title, words)).orderBy(desc(events.start)).limit(limit).all();
  const taskRows = db.select(TASK_COLS).from(tasks).where(likeAll(tasks.title, words)).orderBy(desc(tasks.id)).limit(limit).all();
  const threadRows = db.select(THREAD_COLS).from(threads).where(likeAll(threads.name, words)).orderBy(desc(threads.id)).limit(limit).all();
  return [
    ...threadRows.map((r) => withCount(threadTarget(r), null)),
    ...eventRows.map((r) => withCount(eventTarget(r), r.location)),
    ...taskRows.map((r) => withCount(taskTarget(r), null))
  ];
}

// `remoteOnly` 는 원격 MCP 요청용: 공개로 표시된 메모만 돌려주고, 비공개 메모는 개수에도 넣지 않는다.
// 이름이 걸린 일정 목록(related)도 비운다 — 거기 실리는 메모 수가 비공개 메모의 존재를 드러내기 때문.
export function listNotes(db: CairnDatabase, query: NoteListQuery, opts: { remoteOnly?: boolean } = {}): NoteListData {
  const rows = db
    .select()
    .from(notes)
    .where(and(query.includeArchived ? undefined : isNull(notes.archivedAt), opts.remoteOnly ? eq(notes.remoteVisible, 1) : undefined))
    .all();
  const words = terms(query.q);
  const from = query.date ?? query.from;
  const to = query.date ?? query.to;
  const matched = buildViews(db, rows).filter((note) => {
    if (query.kind && note.kind !== query.kind) return false;
    if (query.open && !note.items.some((i) => !i.done)) return false;
    if (query.targetType && !note.links.some((l) => l.targetType === query.targetType && l.targetId === query.targetId)) return false;
    if (from || to) {
      if (!noteDates(note).some((d) => (!from || d >= from) && (!to || d <= to))) return false;
    }
    if (words.length > 0) {
      const text = haystack(note);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  matched.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const byDate = sortKey(b).localeCompare(sortKey(a));
    return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
  });
  return { notes: matched.slice(0, query.limit), total: matched.length, related: opts.remoteOnly ? [] : findRelated(db, words, 12) };
}

// 메모를 붙일 대상 고르기. 검색어가 없으면 요즘 것(최근·다가오는 일정, 열린 할 일, 진행 중 스레드)을 보여준다.
export function listNoteTargets(db: CairnDatabase, q: string | undefined, limit: number, now: Date = new Date()): NoteTargetView[] {
  const words = terms(q);
  if (words.length > 0) {
    return findRelated(db, words, limit).map((t) => ({
      targetType: t.targetType, targetId: t.targetId, label: t.label, when: t.when, status: t.status, exists: t.exists
    }));
  }
  const sinceMs = now.getTime() - 3 * 86_400_000;
  const untilMs = now.getTime() + 7 * 86_400_000;
  const nearEvents = db
    .select(EVENT_COLS)
    .from(events)
    .all()
    .filter((e) => {
      const ms = e.start ? Date.parse(e.start) : NaN;
      return !Number.isNaN(ms) && ms >= sinceMs && ms <= untilMs && e.status !== "cancelled";
    })
    .sort((a, b) => Math.abs(Date.parse(a.start!) - now.getTime()) - Math.abs(Date.parse(b.start!) - now.getTime()))
    .slice(0, limit);
  const openTasks = db.select(TASK_COLS).from(tasks).where(inArray(tasks.status, ["todo", "doing"])).orderBy(desc(tasks.id)).limit(limit).all();
  const activeThreads = db.select(THREAD_COLS).from(threads).where(eq(threads.status, "active")).orderBy(desc(threads.id)).limit(limit).all();
  return [...nearEvents.map(eventTarget), ...openTasks.map(taskTarget), ...activeThreads.map(threadTarget)];
}
