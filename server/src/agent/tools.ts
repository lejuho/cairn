import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { CairnDatabase } from "../db/index.js";
import { asc, eq } from "drizzle-orm";
import { agentSheets } from "../db/schema.js";
import type { MailAccess, SheetsAccess } from "./mail.js";
import { listUnread, markRead, storeIncoming, type ReasonClient } from "./reason.js";

// The closed set of things the in-app agent can do. Each tool maps onto an existing API route,
// called through the server's own router so validation and rules are exactly the ones the
// screens use. Tools marked `confirm` are never run by the agent itself: they are parked until
// the user presses the button.

export type ToolContext = {
  app: FastifyInstance;
  // false → requests carry the remote-audience header, so only notes the user shared are visible.
  includePrivate: boolean;
  db: CairnDatabase;
  // Present only when the user switched mail reading on for this conversation and mail is connected.
  mail?: MailAccess | undefined;
  // Present when Google is connected with sheet reading and the user registered at least one sheet.
  sheets?: SheetsAccess | undefined;
  // Present when this server has a seat on Reason Network.
  reason?: ReasonClient | undefined;
};

// refs: what this call created or changed, for the conversation's "다룬 항목" list.
export type ToolRef = { type: "event" | "task" | "thread" | "note"; id: number; label: string; action: string };
export type ToolOutcome = { ok: boolean; summary: string; data?: unknown; link?: string; refs?: ToolRef[] };

type ApiResult = { status: number; body: { ok?: boolean; data?: unknown; error?: { message?: string } } };

async function api(ctx: ToolContext, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<ApiResult> {
  const res = await ctx.app.inject({
    method,
    url,
    headers: ctx.includePrivate ? {} : { "x-cairn-audience": "remote" },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {})
  });
  let body: ApiResult["body"] = {};
  try {
    body = res.json() as ApiResult["body"];
  } catch {
    body = { ok: false, error: { message: `HTTP ${res.statusCode}` } };
  }
  return { status: res.statusCode, body };
}

function failure(result: ApiResult, what: string): ToolOutcome {
  const reason = result.status === 403 ? "비공개 메모 접근이 꺼져 있어 할 수 없습니다" : result.body.error?.message ?? `HTTP ${result.status}`;
  return { ok: false, summary: `${what} 실패: ${reason}` };
}

function okOf(result: ApiResult): boolean {
  return result.status >= 200 && result.status < 300 && result.body.ok !== false;
}

const id = z.number().int().positive();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stamp = z.string().datetime({ offset: true });

type Row = Record<string, unknown>;
const pick = (row: unknown, keys: string[]): Row => {
  const src = (row ?? {}) as Row;
  return Object.fromEntries(keys.filter((k) => src[k] !== undefined && src[k] !== null).map((k) => [k, src[k]]));
};
const rows = (value: unknown, keys: string[]): Row[] => (Array.isArray(value) ? value.map((v) => pick(v, keys)) : []);

const EVENT_KEYS = ["id", "title", "start", "end", "status", "location", "threadId", "type"];
const TASK_KEYS = ["id", "title", "status", "due", "estMinutes", "threadId", "context"];
const NOTE_KEYS = ["id", "kind", "title", "body", "noteDate", "items", "links", "remoteVisible"];

export type AgentTool = {
  name: string;
  // Shown to the model.
  description: string;
  // Argument shape, also shown to the model (compact).
  args: string;
  schema: z.ZodTypeAny;
  confirm?: boolean;
  // Changes data (as opposed to only reading).
  writes?: boolean;
  // Only offered when this source is available in the conversation.
  needs?: "mail" | "reason" | "sheets";
  // Returns text written by someone else (mail, another agent). After such a call the rest of
  // the turn may only read and file candidates on its own; everything else waits for approval.
  untrusted?: boolean;
  // Still runs at once after untrusted text was read (it only files something for the user to judge).
  safeAfterUntrusted?: boolean;
  // One-line description of what will happen, for the confirmation button.
  describe?: (args: never) => string;
  // What exactly changes, shown under the confirmation (may be several lines).
  detail?: (args: never) => string;
  run: (ctx: ToolContext, args: never) => Promise<ToolOutcome>;
};

function tool<S extends z.ZodTypeAny>(def: Omit<AgentTool, "schema" | "run" | "describe" | "detail"> & {
  schema: S;
  describe?: (args: z.infer<S>) => string;
  detail?: (args: z.infer<S>) => string;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolOutcome>;
}): AgentTool {
  return def as unknown as AgentTool;
}

export const AGENT_TOOLS: AgentTool[] = [
  // ── read ──
  tool({
    name: "get_calendar", description: "기간 안의 일정과 마감인 할 일을 본다 (최대 62일).",
    args: "{from: YYYY-MM-DD, to: YYYY-MM-DD}", schema: z.object({ from: localDate, to: localDate }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "GET", `/api/calendar?from=${a.from}&to=${a.to}`);
      if (!okOf(r)) return failure(r, "달력 조회");
      const d = r.body.data as Row;
      return { ok: true, summary: `${a.from}~${a.to} 달력 조회`, data: { events: rows(d.events, EVENT_KEYS), tasks: rows(d.tasks, TASK_KEYS), noteCounts: d.noteCounts } };
    }
  }),
  tool({
    name: "list_items", description: "진행 중인 일정과 할 일 전체를 본다.",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      const r = await api(ctx, "GET", "/api/items?scope=active&limit=200");
      if (!okOf(r)) return failure(r, "항목 조회");
      const d = r.body.data as Row;
      return { ok: true, summary: "진행 중 항목 조회", data: { events: rows(d.events, EVENT_KEYS), tasks: rows(d.tasks, TASK_KEYS) } };
    }
  }),
  tool({
    name: "list_threads", description: "모든 스레드와 진행도를 본다.",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      const r = await api(ctx, "GET", "/api/threads");
      if (!okOf(r)) return failure(r, "스레드 조회");
      const list = (r.body.data as Row[]).map((s) => ({ ...pick(s.thread, ["id", "name", "status", "goal", "startDate", "deadline", "domain", "startedAt"]), ...pick(s, ["doneCount", "totalCount", "doingCount"]) }));
      return { ok: true, summary: `스레드 ${list.length}개 조회`, data: list };
    }
  }),
  tool({
    name: "get_thread", description: "스레드 하나의 일정·할 일·다른 스레드와의 관계를 본다.",
    args: "{id: number}", schema: z.object({ id }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "GET", `/api/threads/${a.id}`);
      if (!okOf(r)) return failure(r, "스레드 조회");
      const d = r.body.data as Row;
      const rel = (d.relations ?? {}) as Row;
      const link = (l: unknown) => pick(l, ["id", "kind", "fromThread", "toThread"]);
      return {
        ok: true, summary: `스레드 #${a.id} 조회`, link: `/threads/${a.id}`,
        data: {
          thread: pick(d.thread, ["id", "name", "status", "goal", "startDate", "deadline", "domain", "startedAt"]),
          events: rows(d.events, EVENT_KEYS), tasks: rows(d.tasks, TASK_KEYS), childThreads: d.childThreads,
          relations: { incoming: Array.isArray(rel.incoming) ? rel.incoming.map(link) : [], outgoing: Array.isArray(rel.outgoing) ? rel.outgoing.map(link) : [] }
        }
      };
    }
  }),
  tool({
    name: "search_notes", description: "메모·체크리스트를 찾는다. q 는 내용이나 붙은 일정·스레드 이름, date/from/to 는 날짜.",
    args: "{q?: string, date?: YYYY-MM-DD, from?: YYYY-MM-DD, to?: YYYY-MM-DD}",
    schema: z.object({ q: z.string().max(200).optional(), date: localDate.optional(), from: localDate.optional(), to: localDate.optional() }).strict(),
    run: async (ctx, a) => {
      const params = new URLSearchParams(Object.entries(a).filter(([, v]) => v !== undefined) as Array<[string, string]>);
      params.set("limit", "30");
      const r = await api(ctx, "GET", `/api/notes?${params.toString()}`);
      if (!okOf(r)) return failure(r, "메모 검색");
      const d = r.body.data as Row;
      return { ok: true, summary: `메모 ${Number(d.total ?? 0)}개 찾음`, data: { notes: rows(d.notes, NOTE_KEYS), total: d.total } };
    }
  }),

  // ── add / connect / change: applied at once ──
  tool({
    name: "create_note", writes: true, describe: (a) => `메모 저장: ${String(a.title ?? a.body ?? "체크리스트").split("\n")[0]!.slice(0, 60)}`, description: "메모나 체크리스트를 남긴다. links 로 일정·할 일·스레드에 붙인다.",
    args: "{body?: string, title?: string, kind?: 'note'|'checklist', items?: [{text}], noteDate?: YYYY-MM-DD, links?: [{targetType: 'event'|'task'|'thread', targetId}]}",
    schema: z.object({
      body: z.string().max(10_000).optional(), title: z.string().max(200).optional(), kind: z.enum(["note", "checklist"]).optional(),
      items: z.array(z.object({ text: z.string().min(1).max(300) }).strict()).max(100).optional(), noteDate: localDate.optional(),
      links: z.array(z.object({ targetType: z.enum(["event", "task", "thread"]), targetId: id }).strict()).max(20).optional()
    }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", "/api/notes", { ...a, addedBy: "agent" });
      if (!okOf(r)) return failure(r, "메모 저장");
      const note = (r.body.data as Row).note as Row;
      const label = String(note.title ?? note.body ?? "체크리스트").split("\n")[0]!.slice(0, 60);
      return { ok: true, summary: `메모 저장: ${label.slice(0, 40)}`, link: "/notes", data: pick(note, ["id"]), refs: [{ type: "note", id: Number(note.id), label, action: "생성" }] };
    }
  }),
  tool({
    name: "create_task", writes: true, describe: (a) => `할 일 생성: ${a.title}`, description: "할 일을 만든다. 기한이 말에 있으면 due, 속한 스레드가 있으면 threadId 를 반드시 넣는다.",
    args: "{title: string, due?: YYYY-MM-DD, estMinutes?: number, threadId?: number, context?: string}",
    schema: z.object({ title: z.string().min(1).max(200), due: localDate.optional(), estMinutes: z.number().int().positive().max(1440).optional(), threadId: id.optional(), context: z.string().max(2000).optional() }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", "/api/tasks", a);
      if (!okOf(r)) return failure(r, "할 일 생성");
      const created = pick(r.body.data, ["id"]);
      return { ok: true, summary: `할 일 생성: ${a.title}`, data: created, ...(a.threadId ? { link: `/threads/${a.threadId}` } : {}), refs: [{ type: "task", id: Number(created.id), label: a.title, action: "생성" }] };
    }
  }),
  tool({
    name: "create_event", writes: true, describe: (a) => `일정 생성: ${a.title} (${a.start.slice(0, 16).replace("T", " ")})`, description: "일정을 만든다. 시각은 오프셋이 있는 ISO (예: 2026-11-20T15:00:00+09:00).",
    args: "{title: string, start: ISO, end: ISO, threadId?: number, location?: string}",
    schema: z.object({ title: z.string().min(1).max(200), start: stamp, end: stamp, threadId: id.optional(), location: z.string().max(300).optional() }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", "/api/events", a);
      if (!okOf(r)) return failure(r, "일정 생성");
      const created = pick(r.body.data, ["id"]);
      return { ok: true, summary: `일정 생성: ${a.title} (${a.start.slice(0, 16).replace("T", " ")})`, link: `/calendar?date=${a.start.slice(0, 10)}`, data: created, refs: [{ type: "event", id: Number(created.id), label: a.title, action: "생성" }] };
    }
  }),
  tool({
    name: "create_thread", writes: true, describe: (a) => `스레드 생성: ${a.name}`, description: "스레드를 만든다. 시작하는 날이 말에 있으면 startDate, 끝나는 날이 있으면 deadline 을 반드시 넣는다 (기간이면 끝나는 날을 계산). startDate 가 되면 보드에서 자동으로 진행 중이 된다.",
    args: "{name: string, goal?: string, startDate?: YYYY-MM-DD, deadline?: YYYY-MM-DD, domain?: 'personal'|'work'}",
    schema: z.object({ name: z.string().min(1).max(200), goal: z.string().max(1000).optional(), startDate: localDate.optional(), deadline: localDate.optional(), domain: z.enum(["personal", "work"]).optional() }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", "/api/threads", a);
      if (!okOf(r)) return failure(r, "스레드 생성");
      const created = pick(r.body.data, ["id"]);
      return { ok: true, summary: `스레드 생성: ${a.name}`, data: created, ...(typeof created.id === "number" ? { link: `/threads/${created.id}`, refs: [{ type: "thread" as const, id: created.id, label: a.name, action: "생성" }] } : {}) };
    }
  }),
  tool({
    name: "link_threads", writes: true, describe: (a) => `스레드 연결: #${a.fromThreadId} —${a.kind}→ #${a.toThreadId}`,
    description: "스레드 둘을 연결한다. from → to 방향. contains=from 아래에 to 가 들어감, blocks=from 이 끝나야 to 를 할 수 있음, feeds=from 의 결과가 to 에 쓰임, competes=시간·자원을 다툼, shares=사람·자원을 같이 씀.",
    args: "{fromThreadId: number, toThreadId: number, kind: 'contains'|'blocks'|'feeds'|'competes'|'shares'}",
    schema: z.object({ fromThreadId: id, toThreadId: id, kind: z.enum(["contains", "blocks", "feeds", "competes", "shares"]) }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", `/api/threads/${a.fromThreadId}/links`, { toThreadId: a.toThreadId, kind: a.kind });
      if (!okOf(r)) return failure(r, "스레드 연결");
      return {
        ok: true, summary: `스레드 연결: #${a.fromThreadId} —${a.kind}→ #${a.toThreadId}`, link: `/threads/${a.fromThreadId}`,
        refs: [{ type: "thread", id: a.fromThreadId, label: `스레드 #${a.fromThreadId}`, action: `연결(${a.kind})` }, { type: "thread", id: a.toThreadId, label: `스레드 #${a.toThreadId}`, action: `연결(${a.kind})` }]
      };
    }
  }),
  tool({
    name: "set_task_status", writes: true, describe: (a) => `할 일 #${a.id} → ${a.status}`, description: "할 일의 상태를 바꾼다 (할 일 ↔ 진행 중 ↔ 완료).",
    args: "{id: number, status: 'todo'|'doing'|'done'}", schema: z.object({ id, status: z.enum(["todo", "doing", "done"]) }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "PATCH", `/api/tasks/${a.id}/status`, { status: a.status });
      return okOf(r) ? { ok: true, summary: `할 일 #${a.id} → ${a.status}`, refs: [{ type: "task", id: a.id, label: `할 일 #${a.id}`, action: `상태 ${a.status}` }] } : failure(r, "할 일 상태 변경");
    }
  }),
  tool({
    name: "move_thread", writes: true, describe: (a) => `스레드 #${a.id} → ${a.column}`, description: "스레드를 보드의 다른 열로 옮긴다. done 은 스레드를 완료 처리한다.",
    args: "{id: number, column: 'todo'|'doing'|'done'}", schema: z.object({ id, column: z.enum(["todo", "doing", "done"]) }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "PATCH", `/api/threads/${a.id}/board`, { column: a.column });
      return okOf(r) ? { ok: true, summary: `스레드 #${a.id} → ${a.column}`, link: "/threads", refs: [{ type: "thread", id: a.id, label: `스레드 #${a.id}`, action: `이동 ${a.column}` }] } : failure(r, "스레드 이동");
    }
  }),
  tool({
    name: "record_event_outcome", writes: true, describe: (a) => `일정 #${a.id} 결과 기록: ${a.outcome}`, description: "끝난 일정의 결과를 기록한다 (취소는 cancel_event).",
    args: "{id: number, outcome: 'done'|'moved'|'late', reasonText?: string}",
    schema: z.object({ id, outcome: z.enum(["done", "moved", "late"]), reasonText: z.string().max(500).optional() }).strict(),
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", `/api/events/${a.id}/outcome`, { outcome: a.outcome, ...(a.reasonText ? { reasonText: a.reasonText } : {}) });
      return okOf(r) ? { ok: true, summary: `일정 #${a.id} 결과 기록: ${a.outcome}`, refs: [{ type: "event", id: a.id, label: `일정 #${a.id}`, action: `결과 ${a.outcome}` }] } : failure(r, "결과 기록");
    }
  }),

  // ── remove / cancel: wait for the user's confirmation ──
  tool({
    name: "drop_task", writes: true, confirm: true, description: "할 일을 드롭한다 (안 하기로 함).",
    args: "{id: number, title: string}", schema: z.object({ id, title: z.string().max(200) }).strict(),
    describe: (a) => `할 일 드롭: ${a.title}`,
    run: async (ctx, a) => {
      const r = await api(ctx, "PATCH", `/api/tasks/${a.id}/status`, { status: "dropped" });
      return okOf(r) ? { ok: true, summary: `할 일 드롭: ${a.title}`, refs: [{ type: "task", id: a.id, label: a.title, action: "드롭" }] } : failure(r, "할 일 드롭");
    }
  }),
  tool({
    name: "cancel_event", writes: true, confirm: true, description: "일정을 취소로 기록한다.",
    args: "{id: number, title: string, reasonText?: string}", schema: z.object({ id, title: z.string().max(200), reasonText: z.string().max(500).optional() }).strict(),
    describe: (a) => `일정 취소: ${a.title}`,
    run: async (ctx, a) => {
      const r = await api(ctx, "POST", `/api/events/${a.id}/outcome`, { outcome: "cancelled", ...(a.reasonText ? { reasonText: a.reasonText } : {}) });
      return okOf(r) ? { ok: true, summary: `일정 취소: ${a.title}`, refs: [{ type: "event", id: a.id, label: a.title, action: "취소" }] } : failure(r, "일정 취소");
    }
  }),
  tool({
    name: "set_thread_status", writes: true, confirm: true, description: "스레드를 중지하거나 드롭한다.",
    args: "{id: number, name: string, status: 'paused'|'dropped'}", schema: z.object({ id, name: z.string().max(200), status: z.enum(["paused", "dropped"]) }).strict(),
    describe: (a) => `스레드 ${a.status === "paused" ? "중지" : "드롭"}: ${a.name}`,
    run: async (ctx, a) => {
      const r = await api(ctx, "PATCH", `/api/threads/${a.id}/status`, { status: a.status });
      return okOf(r) ? { ok: true, summary: `스레드 ${a.status === "paused" ? "중지" : "드롭"}: ${a.name}`, link: "/threads", refs: [{ type: "thread", id: a.id, label: a.name, action: a.status === "paused" ? "중지" : "드롭" }] } : failure(r, "스레드 상태 변경");
    }
  }),
  tool({
    name: "unlink_threads", writes: true, confirm: true, description: "스레드 사이의 연결을 끊는다. linkId 는 get_thread 의 relations 에 있다.",
    args: "{threadId: number, linkId: number, description: string}", schema: z.object({ threadId: id, linkId: id, description: z.string().max(200) }).strict(),
    describe: (a) => `스레드 연결 끊기: ${a.description}`,
    run: async (ctx, a) => {
      const r = await api(ctx, "DELETE", `/api/threads/${a.threadId}/links/${a.linkId}`);
      return okOf(r) ? { ok: true, summary: `스레드 연결 끊음: ${a.description}`, link: `/threads/${a.threadId}` } : failure(r, "연결 끊기");
    }
  }),
  // ── edits: also wait for the user's confirmation, showing what will change ──
  tool({
    name: "update_event", writes: true, confirm: true,
    description: "일정의 제목·시간·장소를 고친다. 바꿀 것만 넣는다. 외부 캘린더에서 온 일정은 고칠 수 없다.",
    args: "{id: number, currentTitle: string, title?: string, start?: ISO, end?: ISO, location?: string|null}",
    schema: z.object({ id, currentTitle: z.string().max(200), title: z.string().min(1).max(200).optional(), start: stamp.optional(), end: stamp.optional(), location: z.string().max(300).nullable().optional() })
      .strict()
      .refine((a) => a.title !== undefined || a.start !== undefined || a.end !== undefined || a.location !== undefined, { message: "nothing to change" }),
    describe: (a) => `일정 수정: ${a.currentTitle}`,
    detail: (a) => [
      a.title !== undefined ? `제목 → ${a.title}` : null,
      a.start !== undefined ? `시작 → ${a.start.slice(0, 16).replace("T", " ")}` : null,
      a.end !== undefined ? `끝 → ${a.end.slice(0, 16).replace("T", " ")}` : null,
      a.location !== undefined ? `장소 → ${a.location ?? "없음"}` : null
    ].filter(Boolean).join("\n"),
    run: async (ctx, a) => {
      const { id: eventId, currentTitle, ...patch } = a;
      const r = await api(ctx, "PATCH", `/api/events/${eventId}`, patch);
      if (!okOf(r)) return failure(r, "일정 수정");
      const label = a.title ?? currentTitle;
      return { ok: true, summary: `일정 수정: ${label}`, ...(a.start ? { link: `/calendar?date=${a.start.slice(0, 10)}` } : {}), refs: [{ type: "event", id: eventId, label, action: a.start || a.end ? "시간 변경" : "수정" }] };
    }
  }),
  tool({
    name: "update_thread", writes: true, confirm: true, description: "스레드의 이름·목표·시작일·마감·영역을 고친다. 바꿀 것만 넣는다. 날짜를 없애려면 null.",
    args: "{id: number, currentName: string, name?: string, goal?: string|null, startDate?: YYYY-MM-DD|null, deadline?: YYYY-MM-DD|null, domain?: 'personal'|'work'}",
    schema: z.object({ id, currentName: z.string().max(200), name: z.string().min(1).max(200).optional(), goal: z.string().max(1000).nullable().optional(), startDate: localDate.nullable().optional(), deadline: localDate.nullable().optional(), domain: z.enum(["personal", "work"]).optional() })
      .strict()
      .refine((a) => a.name !== undefined || a.goal !== undefined || a.startDate !== undefined || a.deadline !== undefined || a.domain !== undefined, { message: "nothing to change" }),
    describe: (a) => `스레드 수정: ${a.currentName}`,
    detail: (a) => [
      a.name !== undefined ? `이름 → ${a.name}` : null,
      a.startDate !== undefined ? `시작일 → ${a.startDate ?? "없음"}` : null,
      a.deadline !== undefined ? `마감 → ${a.deadline ?? "없음"}` : null,
      a.goal !== undefined ? `목표 → ${a.goal ?? "없음"}` : null,
      a.domain !== undefined ? `영역 → ${a.domain === "work" ? "업무" : "개인"}` : null
    ].filter(Boolean).join("\n"),
    run: async (ctx, a) => {
      const { id: threadId, currentName, ...patch } = a;
      const r = await api(ctx, "PATCH", `/api/threads/${threadId}`, patch);
      if (!okOf(r)) return failure(r, "스레드 수정");
      const label = a.name ?? currentName;
      return { ok: true, summary: `스레드 수정: ${label}`, link: `/threads/${threadId}`, refs: [{ type: "thread", id: threadId, label, action: a.deadline !== undefined || a.startDate !== undefined ? "기간 변경" : "수정" }] };
    }
  }),
  tool({
    name: "update_task", writes: true, confirm: true, description: "할 일의 제목·마감·예상 시간·설명을 고친다. 바꿀 것만 넣는다.",
    args: "{id: number, currentTitle: string, title?: string, due?: YYYY-MM-DD|null, estMinutes?: number|null, context?: string|null}",
    schema: z.object({ id, currentTitle: z.string().max(200), title: z.string().min(1).max(200).optional(), due: localDate.nullable().optional(), estMinutes: z.number().int().positive().max(1440).nullable().optional(), context: z.string().max(2000).nullable().optional() })
      .strict()
      .refine((a) => a.title !== undefined || a.due !== undefined || a.estMinutes !== undefined || a.context !== undefined, { message: "nothing to change" }),
    describe: (a) => `할 일 수정: ${a.currentTitle}`,
    detail: (a) => [
      a.title !== undefined ? `제목 → ${a.title}` : null,
      a.due !== undefined ? `마감 → ${a.due ?? "없음"}` : null,
      a.estMinutes !== undefined ? `예상 시간 → ${a.estMinutes === null ? "없음" : `${a.estMinutes}분`}` : null,
      a.context !== undefined ? `설명 → ${a.context ?? "없음"}` : null
    ].filter(Boolean).join("\n"),
    run: async (ctx, a) => {
      const { id: taskId, currentTitle, ...patch } = a;
      const r = await api(ctx, "PATCH", `/api/tasks/${taskId}/thread-node`, patch);
      if (!okOf(r)) return failure(r, "할 일 수정");
      const label = a.title ?? currentTitle;
      return { ok: true, summary: `할 일 수정: ${label}`, refs: [{ type: "task", id: taskId, label, action: "수정" }] };
    }
  }),
  tool({
    name: "update_note", writes: true, confirm: true,
    description: "메모나 체크리스트의 내용을 고친다. 바꿀 것만 넣는다. items 를 주면 체크 항목 전체가 그 목록으로 바뀐다 (남길 항목은 id 를 그대로 넣는다).",
    args: "{id: number, currentTitle: string, title?: string|null, body?: string|null, noteDate?: YYYY-MM-DD|null, items?: [{id?: number, text: string, done?: boolean}]}",
    schema: z.object({
      id, currentTitle: z.string().max(200), title: z.string().max(200).nullable().optional(), body: z.string().max(10_000).nullable().optional(),
      noteDate: localDate.nullable().optional(),
      items: z.array(z.object({ id: id.optional(), text: z.string().min(1).max(300), done: z.boolean().optional() }).strict()).max(100).optional()
    }).strict().refine((a) => a.title !== undefined || a.body !== undefined || a.noteDate !== undefined || a.items !== undefined, { message: "nothing to change" }),
    describe: (a) => `메모 수정: ${a.currentTitle}`,
    detail: (a) => [
      a.title !== undefined ? `제목 → ${a.title ?? "없음"}` : null,
      a.noteDate !== undefined ? `날짜 → ${a.noteDate ?? "없음"}` : null,
      a.body !== undefined ? `내용 →\n${a.body ?? "(비움)"}` : null,
      a.items !== undefined ? `항목 →\n${a.items.map((i) => `${i.done ? "☑" : "☐"} ${i.text}`).join("\n")}` : null
    ].filter(Boolean).join("\n").slice(0, 1500),
    run: async (ctx, a) => {
      const { id: noteId, currentTitle, ...patch } = a;
      const r = await api(ctx, "PATCH", `/api/notes/${noteId}`, patch);
      if (!okOf(r)) return failure(r, "메모 수정");
      const label = (a.title ?? currentTitle) || "메모";
      return { ok: true, summary: `메모 수정: ${label}`, link: "/notes", refs: [{ type: "note", id: noteId, label, action: "수정" }] };
    }
  }),
  tool({
    name: "delete_note", writes: true, confirm: true, description: "메모를 지운다.",
    args: "{id: number, title: string}", schema: z.object({ id, title: z.string().max(200) }).strict(),
    describe: (a) => `메모 삭제: ${a.title}`,
    run: async (ctx, a) => {
      const r = await api(ctx, "DELETE", `/api/notes/${a.id}`);
      return okOf(r) ? { ok: true, summary: `메모 삭제: ${a.title}`, link: "/notes" } : failure(r, "메모 삭제");
    }
  }),
  // ── other sources: mail, other agents, and the candidates found there ──
  tool({
    name: "search_mail", needs: "mail", untrusted: true,
    description: "사용자의 Gmail 을 검색한다 (읽기 전용). query 는 Gmail 검색식 (예: 'newer_than:7d 초대 OR 예약 OR 일정', 'from:someone@example.com after:2026/11/01'). 제목과 미리보기만 온다.",
    args: "{query: string, limit?: number (최대 15)}", schema: z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(15).optional() }).strict(),
    run: async (ctx, a) => {
      if (!ctx.mail) return { ok: false, summary: "메일 읽기가 꺼져 있습니다" };
      try {
        const found = await ctx.mail.search(a.query, a.limit ?? 10);
        return { ok: true, summary: `메일 ${found.length}통 찾음`, data: found };
      } catch (e) {
        return { ok: false, summary: `메일 검색 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` };
      }
    }
  }),
  tool({
    name: "read_mail", needs: "mail", untrusted: true, description: "메일 한 통의 본문을 읽는다. id 는 search_mail 결과에 있다.",
    args: "{id: string}", schema: z.object({ id: z.string().min(1).max(100).regex(/^[\w-]+$/) }).strict(),
    run: async (ctx, a) => {
      if (!ctx.mail) return { ok: false, summary: "메일 읽기가 꺼져 있습니다" };
      try {
        const mail = await ctx.mail.read(a.id);
        return { ok: true, summary: `메일 읽음: ${mail.subject.slice(0, 60)}`, data: mail };
      } catch (e) {
        return { ok: false, summary: `메일 읽기 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` };
      }
    }
  }),
  tool({
    name: "list_sheets", needs: "sheets", description: "사용자가 등록한 스프레드시트와 각 시트의 탭을 본다.",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      if (!ctx.sheets) return { ok: false, summary: "읽을 수 있는 시트가 없습니다" };
      const registered = ctx.db.select().from(agentSheets).orderBy(asc(agentSheets.id)).all();
      const list = await Promise.all(registered.map(async (row) => {
        try {
          return { id: row.id, name: row.name, tabs: (await ctx.sheets!.info(row.spreadsheetId)).tabs };
        } catch (e) {
          return { id: row.id, name: row.name, error: e instanceof Error ? e.message : "열 수 없음" };
        }
      }));
      return { ok: true, summary: `시트 ${list.length}개`, data: list };
    }
  }),
  tool({
    name: "read_sheet", needs: "sheets", untrusted: true,
    description: "등록된 스프레드시트의 탭 하나를 읽는다 (읽기 전용). id 는 list_sheets 의 id. tab 을 안 주면 첫 탭. range 를 안 주면 A1:Z150. 각 줄은 '행번호<탭>셀<탭>셀…' 이다. 잘렸으면(truncated) range 로 이어서 읽는다 (예: 'A151:Z300').",
    args: "{id: number, tab?: string, range?: string}", schema: z.object({ id, tab: z.string().min(1).max(100).optional(), range: z.string().max(20).regex(/^[A-Za-z]{1,3}\d{0,6}(:[A-Za-z]{1,3}\d{0,6})?$/).optional() }).strict(),
    run: async (ctx, a) => {
      if (!ctx.sheets) return { ok: false, summary: "읽을 수 있는 시트가 없습니다" };
      const row = ctx.db.select().from(agentSheets).where(eq(agentSheets.id, a.id)).get();
      if (!row) return { ok: false, summary: `등록되지 않은 시트입니다: #${a.id}` };
      try {
        const read = await ctx.sheets.read(row.spreadsheetId, a.tab, a.range);
        return { ok: true, summary: `시트 읽음: ${row.name} · ${read.tab}`, data: { name: row.name, tab: read.tab, range: read.range, truncated: read.truncated, rows: read.rows.join("\n") } };
      } catch (e) {
        return { ok: false, summary: `시트 읽기 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` };
      }
    }
  }),
  tool({
    name: "reason_team", needs: "reason", description: "Reason Network 에 있는 다른 에이전트 세션을 본다 (주소, 무엇을 하는 중인지).",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      if (!ctx.reason) return { ok: false, summary: "Reason Network 를 쓸 수 없습니다" };
      try {
        const team = await ctx.reason.team();
        return { ok: true, summary: `에이전트 세션 ${team.length}개`, data: { me: ctx.reason.session, sessions: team } };
      } catch (e) {
        return { ok: false, summary: `Reason Network 조회 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` };
      }
    }
  }),
  tool({
    name: "reason_inbox", needs: "reason", untrusted: true, description: "다른 에이전트가 이 앱(cairn)에 보낸 메시지 중 아직 안 읽은 것을 읽는다. 읽으면 읽음으로 표시된다.",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      if (!ctx.reason) return { ok: false, summary: "Reason Network 를 쓸 수 없습니다" };
      const now = new Date().toISOString();
      let warning = "";
      try {
        storeIncoming(ctx.db, await ctx.reason.collect(), now);
      } catch (e) {
        warning = ` (새 메시지 확인 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"})`;
      }
      const messages = listUnread(ctx.db);
      markRead(ctx.db, messages.map((m) => m.id), now);
      return { ok: true, summary: `다른 에이전트의 메시지 ${messages.length}건${warning}`, data: messages.map(({ id: _id, ...m }) => m) };
    }
  }),
  tool({
    name: "reason_send", needs: "reason", writes: true,
    description: "다른 에이전트 세션에 메시지를 보낸다. to 는 reason_team 의 address 또는 받은 메시지의 from. 답장이면 replyTo 에 그 메시지의 messageId 를 넣는다. 필요한 것만 한 번에 보낸다.",
    args: "{to: string, message: string, replyTo?: string}",
    schema: z.object({ to: z.string().min(3).max(120).regex(/^[\w.@-]+\/[\w.@-]+$/), message: z.string().min(1).max(4000), replyTo: z.string().max(60).regex(/^[\w-]+$/).optional() }).strict(),
    describe: (a) => `${a.to} 에 메시지 보내기`,
    detail: (a) => a.message.slice(0, 1500),
    run: async (ctx, a) => {
      if (!ctx.reason) return { ok: false, summary: "Reason Network 를 쓸 수 없습니다" };
      try {
        await ctx.reason.send(a.to, a.message, a.replyTo);
        return { ok: true, summary: `${a.to} 에 메시지 보냄` };
      } catch (e) {
        return { ok: false, summary: `메시지 보내기 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` };
      }
    }
  }),
  tool({
    name: "list_candidates", description: "사용자의 결정을 기다리는 일정 후보를 본다.",
    args: "{}", schema: z.object({}).strict(),
    run: async (ctx) => {
      const r = await api(ctx, "GET", "/api/inbox/candidates");
      if (!okOf(r)) return failure(r, "후보 조회");
      const list = ((r.body.data as Row).candidates as Row[]) ?? [];
      return { ok: true, summary: `일정 후보 ${list.length}건`, data: list };
    }
  }),
  tool({
    name: "propose_event", writes: true, safeAfterUntrusted: true,
    description: "메일이나 다른 에이전트의 메시지에서 찾은 일정을 '후보'로 올린다. 달력에는 사용자가 고른 것만 들어간다. sourceLabel 에는 사용자가 알아볼 출처(메일 제목, 보낸 에이전트)를 적는다.",
    args: "{title: string, start: ISO, end?: ISO, location?: string, online?: boolean, url?: string, note?: string, origin: 'gmail'|'reason'|'conversation', sourceLabel: string}",
    schema: z.object({
      title: z.string().min(1).max(200), start: stamp, end: stamp.optional(), location: z.string().max(300).optional(), online: z.boolean().optional(),
      url: z.string().url().max(1000).optional(), note: z.string().max(600).optional(), origin: z.enum(["gmail", "reason", "conversation"]), sourceLabel: z.string().min(1).max(200)
    }).strict(),
    run: async (ctx, a) => {
      const { sourceLabel, note, ...rest } = a;
      const r = await api({ ...ctx, includePrivate: true }, "POST", "/api/inbox/propose-event", { ...rest, note: [`출처: ${sourceLabel}`, note].filter(Boolean).join("\n").slice(0, 1000), proposedBy: "cairn-agent" });
      if (!okOf(r)) return failure(r, "후보 등록");
      const d = r.body.data as Row;
      return { ok: true, summary: `${d.alreadyKnown ? "이미 있는 후보" : "일정 후보 등록"}: ${a.title} (${a.start.slice(0, 16).replace("T", " ")})`, data: pick(d, ["inboxId", "alreadyKnown", "status"]) };
    }
  })
];

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

export function toolAvailable(tool: AgentTool, ctx: Pick<ToolContext, "mail" | "reason" | "sheets">): boolean {
  return tool.needs === undefined || ctx[tool.needs] !== undefined;
}

export function toolManual(ctx: Pick<ToolContext, "mail" | "reason" | "sheets">): string {
  return AGENT_TOOLS.filter((t) => toolAvailable(t, ctx)).map((t) => `- ${t.name}${t.confirm ? " (사용자 확인 후 실행)" : ""} ${t.args}\n  ${t.description}`).join("\n");
}
