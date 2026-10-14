import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { UpdatePersonProfileRequestSchema, type InboxAnswerRequest, type InboxItemView } from "@cairn/shared";
import { findPersonById, updatePersonProfile } from "../repositories/people.js";
import type { CairnDatabase } from "../db/index.js";
import { annotations, events, inboxItems, threads, threadWorkspaces } from "../db/schema.js";
import { findAllWatchers, findTaskStatusesByIds } from "../repositories/watchers.js";
import { buildWatcherDeepView } from "./watcher-deep-view.js";
import { findDueMaterials, getCaptureCheck, MATERIAL_KIND_KO, updateEventMaterial } from "./event-materials.js";
import { parseReversePlanRule } from "./watcher-reverse-plan.js";

const TIME_ZONE = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";
const DAY_MS = 86_400_000;
const OUTCOME_LOOKBACK_MS = 3 * DAY_MS;
const DEADLINE_HORIZON_DAYS = 7;
const WORKSPACE_BOOST = 30;

type InboxRow = typeof inboxItems.$inferSelect;
type NewInboxItem = typeof inboxItems.$inferInsert;

export type InboxError = { code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR"; message: string };

function localDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(ms));
}

function localTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function isAllDay(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const midnight = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(iso)) === "00:00";
  return midnight(start) && midnight(end) && Date.parse(end) - Date.parse(start) >= DAY_MS;
}

/** dedupe_key 가 이미 있으면 건드리지 않는다 — 답한/무시한 질문이 다시 살아나지 않게. */
export function upsertInboxItem(db: CairnDatabase, item: NewInboxItem): void {
  db.insert(inboxItems).values(item).onConflictDoNothing({ target: inboxItems.dedupeKey }).run();
}

/** 기존 데이터(끝난 일정, 마감, watcher)에서 질문을 만들어 inbox 에 적재. 멱등. */
export function materializeDerivedItems(db: CairnDatabase, nowIso: string): void {
  const nowMs = Date.parse(nowIso);

  const ended = db
    .select({ event: events })
    .from(events)
    .leftJoin(annotations, eq(annotations.eventId, events.id))
    .where(and(or(eq(events.status, "planned"), eq(events.status, "confirmed")), isNull(annotations.id)))
    .all()
    .map((r) => r.event)
    .filter((e) => {
      if (!e.end || isAllDay(e.start, e.end)) return false;
      const endMs = Date.parse(e.end);
      return endMs <= nowMs && endMs >= nowMs - OUTCOME_LOOKBACK_MS;
    });
  for (const e of ended) {
    upsertInboxItem(db, {
      kind: "outcome_check",
      dedupeKey: `outcome:event:${e.id}`,
      prompt: `${localTimeLabel(e.start ?? e.end!)} '${e.title}' 어떻게 됐어요? (done/cancelled/moved/late)`,
      threadId: e.threadId,
      subjectType: "event",
      subjectId: e.id,
      priority: e.selfImposed ? 55 : 45,
      expiresAt: new Date(Date.parse(e.end!) + 7 * DAY_MS).toISOString()
    });
  }

  const today = localDate(nowMs);
  const horizon = localDate(nowMs + DEADLINE_HORIZON_DAYS * DAY_MS);
  const dueThreads = db
    .select()
    .from(threads)
    .where(and(eq(threads.status, "active"), lte(threads.deadline, horizon)))
    .all()
    .filter((t) => t.deadline && t.deadline.slice(0, 10) >= localDate(nowMs - 3 * DAY_MS));
  for (const t of dueThreads) {
    const deadline = t.deadline!.slice(0, 10);
    const daysLeft = Math.round((Date.parse(deadline) - Date.parse(today)) / DAY_MS);
    const when = daysLeft < 0 ? `${-daysLeft}일 지났어요` : daysLeft === 0 ? "오늘이에요" : `${daysLeft}일 남았어요`;
    upsertInboxItem(db, {
      kind: "deadline",
      // 마감일이 바뀌면 새 질문으로 취급.
      dedupeKey: `deadline:thread:${t.id}:${deadline}`,
      prompt: `'${t.name}' 마감(${deadline})이 ${when}. 진행 상황이나 막힌 점이 있나요?`,
      threadId: t.id,
      subjectType: "thread",
      subjectId: t.id,
      priority: Math.min(95, 90 - Math.max(daysLeft, 0) * 6),
      expiresAt: new Date(Date.parse(deadline) + 3 * DAY_MS).toISOString()
    });
  }

  const watcherRows = findAllWatchers(db);
  const taskIds = watcherRows.flatMap((row) => {
    const rule = parseReversePlanRule(row.rule);
    return rule ? [...rule.steps.map((s) => s.taskId), rule.targetTaskId] : [];
  });
  const deep = buildWatcherDeepView(watcherRows, today, nowIso, findTaskStatusesByIds(db, taskIds));
  for (const w of deep.filter((d) => d.status === "due")) {
    upsertInboxItem(db, {
      kind: "watcher_due",
      dedupeKey: `watcher:${w.id}:${today}`,
      prompt: w.message || `'${w.label ?? "watcher"}' 확인할 때가 됐어요.`,
      subjectType: "watcher",
      subjectId: w.id,
      priority: 60 + Math.min(w.daysOverdue ?? 0, 5) * 5,
      expiresAt: new Date(nowMs + DAY_MS).toISOString()
    });
  }

  for (const { material: m, event: e } of findDueMaterials(db, nowIso)) {
    const what = `${m.label ? `${m.label} ` : ""}${MATERIAL_KIND_KO[m.kind as keyof typeof MATERIAL_KIND_KO] ?? m.kind}`;
    upsertInboxItem(db, {
      kind: "material_due",
      // 예정 시점을 다시 잡으면 새 질문으로 취급.
      dedupeKey: `material:${m.id}:${m.expectedAt}`,
      prompt: `'${e.title}' ${what} 공개 예정 시점이 됐어요.${m.sourceUrl ? ` ${m.sourceUrl} 에서` : ""} 올라왔는지 확인해 볼까요?`,
      threadId: e.threadId,
      subjectType: "material",
      subjectId: m.id,
      payload: JSON.stringify({ eventId: e.id, kind: m.kind, label: m.label, sourceUrl: m.sourceUrl }),
      priority: 40,
      expiresAt: new Date(Date.parse(m.expectedAt!) + 14 * DAY_MS).toISOString()
    });
  }
}

function expireStale(db: CairnDatabase, nowIso: string): void {
  db.update(inboxItems)
    .set({ status: "expired" })
    .where(and(eq(inboxItems.status, "pending"), lte(inboxItems.expiresAt, nowIso)))
    .run();
}

function workspaceThreadIds(db: CairnDatabase, cwd: string | undefined): Set<number> {
  if (!cwd) return new Set();
  const rows = db.select().from(threadWorkspaces).all();
  return new Set(
    rows.filter((r) => cwd === r.path || cwd.startsWith(r.path.endsWith("/") ? r.path : `${r.path}/`)).map((r) => r.threadId)
  );
}

const ANSWER_HINTS: Record<InboxRow["kind"], string> = {
  outcome_check: "accept + value.outcome(done|cancelled|moved|late), note=이유 한 줄. 모르면 snooze.",
  deadline: "accept + note=진행 상황/막힌 점. 아직이면 snooze, 무관하면 dismiss.",
  watcher_due: "accept = 처리함, snooze = 나중에, dismiss = 무시.",
  event_candidate: "accept = 일정으로 등록(value 로 title/start/end/location 수정 가능), reject = 일정 아님.",
  thread_link: "accept = 연결(value.threadId 로 다른 thread 지정 가능), reject = 무관.",
  material_due: "에이전트가 sourceUrl 을 직접 확인: 올라왔으면 accept + value.url, 아직이면 accept + value.expectedAt(다음 확인 시점) 또는 snooze, 공개 안 한다고 확인되면 reject(=missing).",
  person_profile: "accept + value 에 사용자가 말한 것만: leadTimeDays(0~30), preferredWeekdays+preferredPeriods(morning|afternoon|evening, 둘 다 함께), unavailableWeekdays (요일은 monday..sunday). 모르면 snooze."
};

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toView(row: InboxRow, names: Map<number, string>, boosted: Set<number>): InboxItemView {
  const workspace = row.threadId != null && boosted.has(row.threadId);
  return {
    id: row.id,
    kind: row.kind as InboxItemView["kind"],
    prompt: row.prompt,
    priority: row.priority + (workspace ? WORKSPACE_BOOST : 0),
    relevance: workspace ? "workspace" : "global",
    threadId: row.threadId,
    threadName: row.threadId != null ? (names.get(row.threadId) ?? null) : null,
    subject: row.subjectType && row.subjectId != null ? { type: row.subjectType, id: row.subjectId } : null,
    payload: parseJson(row.payload) as Record<string, unknown> | null,
    evidence: parseJson(row.evidence) as unknown[] | null,
    createdAt: row.createdAt ?? "",
    answerHint: ANSWER_HINTS[row.kind as InboxRow["kind"]] ?? ""
  };
}

export function listInbox(
  db: CairnDatabase,
  opts: { cwd?: string | undefined; now?: string | undefined; limit?: number | undefined }
): { items: InboxItemView[]; pendingTotal: number } {
  const nowIso = opts.now ?? new Date().toISOString();
  materializeDerivedItems(db, nowIso);
  expireStale(db, nowIso);

  const rows = db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.status, "pending"), or(isNull(inboxItems.snoozedUntil), lte(inboxItems.snoozedUntil, nowIso))))
    .all();
  const names = new Map(db.select({ id: threads.id, name: threads.name }).from(threads).all().map((t) => [t.id, t.name]));
  const boosted = workspaceThreadIds(db, opts.cwd);
  const items = rows
    .map((r) => toView(r, names, boosted))
    .sort((a, b) => b.priority - a.priority || b.id - a.id);
  return { items: items.slice(0, opts.limit ?? 10), pendingTotal: items.length };
}

const OUTCOMES = new Set(["done", "cancelled", "moved", "late"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** 답 기록. 수락/거절 모두 남겨서 이후 추론의 학습 재료로 쓴다. */
export function answerInboxItem(
  db: CairnDatabase,
  id: number,
  req: InboxAnswerRequest,
  nowIso = new Date().toISOString()
): { ok: true; item: InboxRow; effect: Record<string, unknown> | null } | { ok: false; error: InboxError } {
  const item = db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
  if (!item) return { ok: false, error: { code: "NOT_FOUND", message: `inbox item ${id} not found` } };
  if (item.status !== "pending") {
    return { ok: false, error: { code: "CONFLICT", message: `inbox item ${id} is already ${item.status}` } };
  }

  const record = (patch: Partial<NewInboxItem>, effect: Record<string, unknown> | null = null) => {
    const [row] = db
      .update(inboxItems)
      .set({
        decision: req.decision,
        answer: JSON.stringify({ value: req.value ?? null, note: req.note ?? null }),
        answeredBy: req.answeredBy ?? null,
        answeredAt: nowIso,
        ...patch
      })
      .where(eq(inboxItems.id, id))
      .returning()
      .all();
    return { ok: true as const, item: row!, effect };
  };

  if (req.decision === "snooze") {
    const hours = req.snoozeHours ?? 20;
    return record({ status: "pending", snoozedUntil: new Date(Date.parse(nowIso) + hours * 3_600_000).toISOString() });
  }
  if (req.decision === "dismiss") return record({ status: "dismissed" });
  if (req.decision === "reject") {
    if (item.kind === "material_due" && item.subjectId != null) {
      updateEventMaterial(db, item.subjectId, { status: "missing", ...(req.note ? { note: req.note } : {}) }, nowIso);
    }
    return record({ status: "answered" });
  }

  const value = req.value ?? {};
  const payload = (parseJson(item.payload) ?? {}) as Record<string, unknown>;

  return db.transaction((tx) => {
    const txDb = tx as unknown as CairnDatabase;
    switch (item.kind) {
      case "outcome_check": {
        const outcome = str(value.outcome);
        if (!outcome || !OUTCOMES.has(outcome) || item.subjectId == null) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: "value.outcome must be done|cancelled|moved|late" } };
        }
        txDb.insert(annotations)
          .values({ eventId: item.subjectId, outcome, reasonTags: "[]", reasonText: req.note ?? null, energyAtTime: null })
          .run();
        txDb.update(events).set({ status: outcome }).where(eq(events.id, item.subjectId)).run();
        const effect: Record<string, unknown> = { annotatedEventId: item.subjectId, outcome };
        if (outcome === "done") {
          // 다녀온 일정이면 남길 자료가 있는지 이어서 챙기도록 체크리스트를 돌려준다.
          const check = getCaptureCheck(txDb, item.subjectId);
          const open = check?.items.filter((i) => i.covered === null) ?? [];
          if (check && open.length > 0) effect.captureCheck = { ...check, items: open };
        }
        return record({ status: "answered" }, effect);
      }
      case "event_candidate": {
        const title = str(value.title) ?? str(payload.title);
        const start = str(value.start) ?? str(payload.start);
        const end = str(value.end) ?? str(payload.end) ?? (start ? new Date(Date.parse(start) + 3_600_000).toISOString() : undefined);
        if (!title || !start || Number.isNaN(Date.parse(start)) || !end || Number.isNaN(Date.parse(end))) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: "event_candidate needs title and start (value or payload)" } };
        }
        const threadId = typeof value.threadId === "number" ? value.threadId : item.threadId;
        const [ev] = txDb.insert(events)
          .values({
            title,
            start,
            end,
            location: str(value.location) ?? str(payload.location) ?? null,
            mode: payload.online === true ? "remote" : null,
            threadId: threadId ?? null,
            // 사용자가 확인한 외부 약속 — 앱 생성(self_imposed=1)과 구분.
            source: "manual",
            selfImposed: 0,
            status: "planned"
          })
          .returning()
          .all();
        return record({ status: "answered", subjectType: "event", subjectId: ev!.id }, { createdEventId: ev!.id });
      }
      case "thread_link": {
        const threadId = typeof value.threadId === "number" ? value.threadId : (payload.threadId as number | undefined);
        if (!threadId || !txDb.select().from(threads).where(eq(threads.id, threadId)).get()) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: "thread_link needs an existing threadId" } };
        }
        const effect: Record<string, unknown> = { threadId };
        if (item.subjectType === "event" && item.subjectId != null) {
          txDb.update(events).set({ threadId }).where(eq(events.id, item.subjectId)).run();
          effect.linkedEventId = item.subjectId;
        }
        const path = str(payload.cwd);
        if (path) {
          txDb.insert(threadWorkspaces).values({ threadId, path }).onConflictDoNothing().run();
          effect.workspace = path;
        }
        return record({ status: "answered", threadId }, effect);
      }
      case "person_profile": {
        const person = item.subjectId != null ? findPersonById(txDb, item.subjectId) : null;
        if (!person) return { ok: false as const, error: { code: "NOT_FOUND" as const, message: "person not found" } };
        // 사용자가 말한 필드만 덮어쓰고 나머지는 기존 프로필 유지.
        const merged = UpdatePersonProfileRequestSchema.safeParse({
          preferredWeekdays: value.preferredWeekdays ?? person.preferredWindows?.weekdays ?? [],
          preferredPeriods: value.preferredPeriods ?? person.preferredWindows?.periods ?? [],
          leadTimeDays: value.leadTimeDays ?? person.leadTime?.days ?? null,
          channel: value.channel ?? person.channel ?? "none",
          unavailableWeekdays: value.unavailableWeekdays
            ?? (person.hardConstraints ?? []).filter((c) => c.type === "weekday_unavailable").map((c) => c.weekday)
        });
        if (!merged.success) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: merged.error.message } };
        }
        if (!updatePersonProfile(txDb, person.id, merged.data)) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: "contradictory profile (preferred vs unavailable weekday)" } };
        }
        return record({ status: "answered" }, { updatedPersonId: person.id });
      }
      case "material_due": {
        if (item.subjectId == null) return record({ status: "answered" });
        const url = str(value.url);
        const expectedAt = str(value.expectedAt);
        const patch = url
          ? { status: "available" as const, url }
          : expectedAt && !Number.isNaN(Date.parse(expectedAt))
            ? { status: "expected" as const, expectedAt: new Date(Date.parse(expectedAt)).toISOString() }
            : null;
        if (!patch) {
          return { ok: false as const, error: { code: "VALIDATION_ERROR" as const, message: "material_due accept needs value.url or value.expectedAt" } };
        }
        const result = updateEventMaterial(txDb, item.subjectId, { ...patch, ...(req.note ? { note: req.note } : {}) }, nowIso);
        if (!result.ok) return { ok: false as const, error: { code: result.code, message: result.message } };
        return record({ status: "answered" }, { material: result.material });
      }
      default:
        return record({ status: "answered" });
    }
  });
}

export function setThreadWorkspace(db: CairnDatabase, threadId: number, path: string): boolean {
  if (!db.select().from(threads).where(eq(threads.id, threadId)).get()) return false;
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  db.insert(threadWorkspaces)
    .values({ threadId, path: normalized })
    .onConflictDoUpdate({ target: threadWorkspaces.path, set: { threadId } })
    .run();
  return true;
}

/** 지금 맥락: 진행 중/다음 일정, cwd 에 묶인 thread, 상위 inbox. 결정적 집계(LLM 없음). */
export function buildContextNow(db: CairnDatabase, opts: { cwd?: string | undefined; now?: string | undefined }) {
  const nowIso = opts.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const until = new Date(nowMs + DAY_MS).toISOString();
  const upcoming = db
    .select({ id: events.id, title: events.title, start: events.start, end: events.end, location: events.location, threadId: events.threadId, status: events.status })
    .from(events)
    .where(and(inArray(events.status, ["planned", "confirmed"]), lte(events.start, until), gte(events.end, nowIso)))
    .orderBy(events.start)
    .all()
    .filter((e) => e.start && e.end && Date.parse(e.start) <= nowMs + DAY_MS && Date.parse(e.end) >= nowMs && !isAllDay(e.start, e.end))
    .map((e) => ({ ...e, ongoing: Date.parse(e.start!) <= nowMs }));

  const boosted = workspaceThreadIds(db, opts.cwd);
  const activeThreads = db
    .select({ id: threads.id, name: threads.name, goal: threads.goal, deadline: threads.deadline })
    .from(threads)
    .where(eq(threads.status, "active"))
    .orderBy(desc(threads.id))
    .all()
    .map((t) => ({ ...t, matchesWorkspace: boosted.has(t.id) }))
    .sort((a, b) => Number(b.matchesWorkspace) - Number(a.matchesWorkspace) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  const inbox = listInbox(db, { cwd: opts.cwd, now: nowIso, limit: 5 });
  return { now: nowIso, cwd: opts.cwd ?? null, upcoming, activeThreads, inbox };
}
