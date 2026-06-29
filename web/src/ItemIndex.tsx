import { useCallback, useEffect, useState } from "react";
import type { EventDetailData, EventRow, EventStatus, ItemListData, ItemListScope, SlotCandidate, TaskRow, TaskStatus } from "@cairn/shared";
import { apiJson } from "./api.js";
import { localDateString, localNowRfc3339 } from "./dateUtils.js";
import { SlotCandidatePicker } from "./SlotCandidatePicker.js";

const EVENT_STATUS_LABEL: Record<string, string> = {
  planned: "계획",
  confirmed: "확정",
  done: "완료",
  cancelled: "취소",
  moved: "이동",
  late: "늦음"
};

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "대기",
  doing: "진행",
  done: "완료",
  dropped: "드롭"
};

const EVENT_STATUS_ACTIONS: EventStatus[] = ["done", "cancelled", "moved", "late"];
const TASK_STATUS_ACTIONS: TaskStatus[] = ["todo", "doing", "done", "dropped"];
const MINUTE_MS = 60_000;
const DAY_MINUTES = 1_440;

type EventSheetState =
  | { tag: "loading"; eventId: number }
  | { tag: "loaded"; eventId: number; data: EventDetailData; saving: EventStatus | null; error: string | null }
  | { tag: "error"; eventId: number; message: string };

type TaskSheetState = {
  task: TaskRow;
  saving: TaskStatus | null;
  error: string | null;
};

type EventSlotState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "loaded"; candidates: SlotCandidate[] }
  | { tag: "applying"; candidates: SlotCandidate[]; start: string }
  | { tag: "error"; message: string };

type TaskSlotState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "loaded"; candidates: SlotCandidate[]; date: string; now: string; days: number }
  | { tag: "applying"; candidates: SlotCandidate[]; date: string; now: string; days: number; start: string }
  | { tag: "error"; message: string };

function formatEventTime(event: EventRow): string {
  if (!event.start) return "날짜 없음";
  const start = event.start.slice(0, 16).replace("T", " ");
  const end = event.end ? event.end.slice(11, 16) : null;
  return end ? `${start}-${end}` : start;
}

function parseTimeMs(value: string | null): number | null {
  if (value == null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function parseDueBoundaryMs(due: string | null): number | null {
  if (due == null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localStart = new Date(year, month - 1, day);
  if (localStart.getFullYear() !== year || localStart.getMonth() !== month - 1 || localStart.getDate() !== day) {
    return null;
  }
  return new Date(year, month - 1, day + 1).getTime();
}

function formatDuration(absMs: number): string {
  if (absMs > 0 && absMs < MINUTE_MS) return "1분 미만";
  const totalMinutes = Math.floor(absMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / DAY_MINUTES);
  const hours = Math.floor((totalMinutes % DAY_MINUTES) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}분`);
  return parts.join(" ");
}

function eventCountdown(event: EventRow, nowMs: number): string | null {
  const startMs = parseTimeMs(event.start);
  if (startMs == null) return null;
  const endMs = parseTimeMs(event.end);
  if (endMs != null && startMs <= nowMs && nowMs < endMs) {
    return `${formatDuration(endMs - nowMs)} 남음 · 진행 중`;
  }
  if (startMs > nowMs) return `${formatDuration(startMs - nowMs)} 남음`;
  return `${formatDuration(nowMs - (endMs ?? startMs))} 지남`;
}

function taskCountdown(task: TaskRow, nowMs: number): string | null {
  const dueMs = parseDueBoundaryMs(task.due);
  if (dueMs == null) return null;
  if (dueMs >= nowMs) return `${formatDuration(dueMs - nowMs)} 남음`;
  return `${formatDuration(nowMs - dueMs)} 지남`;
}

function eventMeta(event: EventRow): string {
  const parts = [formatEventTime(event)];
  if (event.location) parts.push(event.location);
  if (event.threadId != null) parts.push(`스레드 #${event.threadId}`);
  return parts.join(" · ");
}

function taskMeta(task: TaskRow): string {
  const parts = [task.due ? `마감 ${task.due}` : "마감 없음"];
  if (task.estMinutes != null) parts.push(`${task.estMinutes}분`);
  if (task.threadId != null) parts.push(`스레드 #${task.threadId}`);
  return parts.join(" · ");
}

async function fetchEventDetail(id: number): Promise<EventDetailData> {
  const body = await apiJson<{ ok: boolean; data?: EventDetailData; error?: { message: string } }>(`/api/events/${id}`);
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? "일정을 불러오지 못했어");
  return body.data;
}

async function patchEventStatus(id: number, status: EventStatus): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!body.ok) throw new Error(body.error?.message ?? "상태 변경 실패");
}

async function patchTaskStatus(id: number, status: TaskStatus): Promise<TaskRow> {
  const body = await apiJson<{ ok: boolean; data?: TaskRow; error?: { message: string } }>(`/api/tasks/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? "상태 변경 실패");
  return body.data;
}

async function fetchEventSlotCandidates(id: number): Promise<SlotCandidate[]> {
  const now = localNowRfc3339();
  const date = localDateString();
  const body = await apiJson<{ ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } }>(
    `/api/events/${id}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=7`
  );
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? "후보 로딩 실패");
  return body.data.candidates;
}

async function scheduleEvent(id: number, start: string, end: string): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/events/${id}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end })
  });
  if (!body.ok) throw new Error(body.error?.message ?? "일정 저장 실패");
}

async function fetchTaskSlotCandidates(id: number): Promise<{ candidates: SlotCandidate[]; date: string; now: string; days: number }> {
  const now = localNowRfc3339();
  const date = localDateString();
  const days = 7;
  const body = await apiJson<{ ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } }>(
    `/api/tasks/${id}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=${days}`
  );
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? "후보 로딩 실패");
  return { candidates: body.data.candidates, date, now, days };
}

async function scheduleTaskBlock(
  id: number,
  candidate: SlotCandidate,
  ctx: { date: string; now: string; days: number }
): Promise<TaskRow> {
  const body = await apiJson<{ ok: boolean; data?: { task: TaskRow }; error?: { message: string } }>(`/api/tasks/${id}/schedule-block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: ctx.date, now: ctx.now, days: ctx.days, start: candidate.start, end: candidate.end })
  });
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? "일정 만들기 실패");
  return body.data.task;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isEventRow(value: unknown): value is EventRow {
  return isRecord(value) &&
    typeof value.id === "number" &&
    isNullableNumber(value.threadId) &&
    typeof value.title === "string" &&
    isNullableString(value.start) &&
    isNullableString(value.end) &&
    isNullableString(value.location) &&
    isNullableString(value.status) &&
    isNullableString(value.createdAt) &&
    isNullableString(value.updatedAt);
}

function isTaskRow(value: unknown): value is TaskRow {
  return isRecord(value) &&
    typeof value.id === "number" &&
    isNullableNumber(value.threadId) &&
    typeof value.title === "string" &&
    isNullableNumber(value.estMinutes) &&
    isNullableString(value.due) &&
    isNullableString(value.context) &&
    isNullableString(value.status) &&
    isNullableNumber(value.optional) &&
    isNullableString(value.createdAt);
}

function parseList(raw: unknown): ItemListData {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.data)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  const { scope, events, tasks } = raw.data;
  if ((scope !== "active" && scope !== "all") || !Array.isArray(events) || !Array.isArray(tasks)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  if (!events.every(isEventRow) || !tasks.every(isTaskRow)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  return { scope, events, tasks };
}

export function ItemIndex() {
  const [scope, setScope] = useState<ItemListScope>("active");
  const [state, setState] = useState<"loading" | "live" | "error">("loading");
  const [data, setData] = useState<ItemListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [eventSheet, setEventSheet] = useState<EventSheetState | null>(null);
  const [taskSheet, setTaskSheet] = useState<TaskSheetState | null>(null);
  const [eventSlotState, setEventSlotState] = useState<Record<number, EventSlotState>>({});
  const [taskSlotState, setTaskSlotState] = useState<Record<number, TaskSlotState>>({});

  const load = useCallback(async (nextScope: ItemListScope) => {
    setState("loading");
    setError(null);
    try {
      const raw = await apiJson<unknown>(`/api/items?scope=${nextScope}&limit=100`);
      setData(parseList(raw));
      setState("live");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "항목을 불러오지 못했어");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), MINUTE_MS);
    return () => window.clearInterval(tick);
  }, []);

  const switchScope = (nextScope: ItemListScope) => {
    if (nextScope !== scope) setScope(nextScope);
  };

  const isQuiet = state === "live" && data != null && data.events.length === 0 && data.tasks.length === 0;

  const openEventDetail = async (eventId: number) => {
    setTaskSheet(null);
    setEventSheet({ tag: "loading", eventId });
    setEventSlotState((s) => ({ ...s, [eventId]: { tag: "idle" } }));
    try {
      const detail = await fetchEventDetail(eventId);
      setEventSheet({ tag: "loaded", eventId, data: detail, saving: null, error: null });
    } catch (err: unknown) {
      setEventSheet({ tag: "error", eventId, message: err instanceof Error ? err.message : "일정을 불러오지 못했어" });
    }
  };

  const updateEventStatus = async (status: EventStatus) => {
    if (eventSheet?.tag !== "loaded" || eventSheet.saving != null) return;
    const eventId = eventSheet.eventId;
    setEventSheet({ ...eventSheet, saving: status, error: null });
    try {
      await patchEventStatus(eventId, status);
      const detail = await fetchEventDetail(eventId);
      setEventSheet({ tag: "loaded", eventId, data: detail, saving: null, error: null });
      await load(scope);
    } catch (err: unknown) {
      setEventSheet((sheet) => sheet?.tag === "loaded"
        ? { ...sheet, saving: null, error: err instanceof Error ? err.message : "상태 변경 실패" }
        : sheet);
    }
  };

  const openTaskDetail = (task: TaskRow) => {
    setEventSheet(null);
    setTaskSheet({ task, saving: null, error: null });
    setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "idle" } }));
  };

  const updateTaskStatus = async (status: TaskStatus) => {
    if (!taskSheet || taskSheet.saving != null) return;
    setTaskSheet({ ...taskSheet, saving: status, error: null });
    try {
      const task = await patchTaskStatus(taskSheet.task.id, status);
      setTaskSheet({ task, saving: null, error: null });
      await load(scope);
    } catch (err: unknown) {
      setTaskSheet((sheet) => sheet
        ? { ...sheet, saving: null, error: err instanceof Error ? err.message : "상태 변경 실패" }
        : sheet);
    }
  };

  const loadEventSlots = async (eventId: number) => {
    setEventSlotState((s) => ({ ...s, [eventId]: { tag: "loading" } }));
    try {
      const candidates = await fetchEventSlotCandidates(eventId);
      setEventSlotState((s) => ({ ...s, [eventId]: { tag: "loaded", candidates } }));
    } catch (err: unknown) {
      setEventSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: err instanceof Error ? err.message : "후보 로딩 실패" } }));
    }
  };

  const applyEventSlot = async (eventId: number, candidate: SlotCandidate) => {
    const prior = eventSlotState[eventId];
    const candidates = prior?.tag === "loaded" || prior?.tag === "applying" ? prior.candidates : [];
    setEventSlotState((s) => ({ ...s, [eventId]: { tag: "applying", candidates, start: candidate.start } }));
    try {
      await scheduleEvent(eventId, candidate.start, candidate.end);
      const detail = await fetchEventDetail(eventId);
      setEventSheet({ tag: "loaded", eventId, data: detail, saving: null, error: null });
      setEventSlotState((s) => ({ ...s, [eventId]: { tag: "idle" } }));
      await load(scope);
    } catch (err: unknown) {
      setEventSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: err instanceof Error ? err.message : "일정 저장 실패" } }));
    }
  };

  const loadTaskSlots = async (task: TaskRow) => {
    if (task.due == null) {
      setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "error", message: "마감일을 먼저 넣어야 후보를 계산할 수 있어" } }));
      return;
    }
    setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "loading" } }));
    try {
      const loaded = await fetchTaskSlotCandidates(task.id);
      setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "loaded", ...loaded } }));
    } catch (err: unknown) {
      setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "error", message: err instanceof Error ? err.message : "후보 로딩 실패" } }));
    }
  };

  const applyTaskSlot = async (task: TaskRow, candidate: SlotCandidate) => {
    const prior = taskSlotState[task.id];
    if (prior?.tag !== "loaded" && prior?.tag !== "applying") return;
    setTaskSlotState((s) => ({ ...s, [task.id]: { ...prior, tag: "applying", start: candidate.start } }));
    try {
      const updatedTask = await scheduleTaskBlock(task.id, candidate, prior);
      setTaskSheet({ task: updatedTask, saving: null, error: null });
      setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "idle" } }));
      await load(scope);
    } catch (err: unknown) {
      setTaskSlotState((s) => ({ ...s, [task.id]: { tag: "error", message: err instanceof Error ? err.message : "일정 만들기 실패" } }));
    }
  };

  return (
    <main className="items-page" aria-labelledby="items-title">
      <header className="items-header">
        <div>
          <p className="eyebrow">inventory</p>
          <h1 id="items-title">항목</h1>
        </div>
        <div className="items-scope" role="group" aria-label="항목 범위">
          <button type="button" aria-pressed={scope === "active"} onClick={() => switchScope("active")}>진행 중</button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => switchScope("all")}>전체</button>
        </div>
      </header>

      {state === "loading" && (
        <section className="items-skeleton" aria-label="항목 불러오는 중" data-testid="items-loading">
          <span />
          <span />
          <span />
        </section>
      )}

      {state === "error" && (
        <section className="items-error" role="alert" data-testid="items-error">
          <h2>항목을 못 불러왔어</h2>
          <p>{error ?? "서버 상태를 확인해줘."}</p>
          <button type="button" onClick={() => void load(scope)}>다시 시도</button>
        </section>
      )}

      {isQuiet && (
        <section className="quiet-card warm" data-testid="items-quiet">
          <span className="quiet-dot" aria-hidden="true" />
          <h2>{scope === "active" ? "진행 중인 항목은 조용해" : "아직 항목이 없어"}</h2>
          <p>새 일정이나 할 일을 넣으면 여기서 바로 찾을 수 있어.</p>
          <a className="items-create-link" href="/input">입력하기</a>
        </section>
      )}

      {state === "live" && data && !isQuiet && (
        <div className="items-grid" data-testid="items-live">
          <section className="items-section" aria-labelledby="items-events-title">
            <div className="items-section-head">
              <h2 id="items-events-title">일정</h2>
              <span>{data.events.length}</span>
            </div>
            {data.events.length === 0 ? (
              <p className="items-empty-line">보이는 일정이 없어.</p>
            ) : (
              <ul className="items-list" role="list">
                {data.events.map((event) => {
                  const countdown = eventCountdown(event, nowMs);
                  return (
	                  <li className="items-card" key={event.id}>
	                    <div>
	                      <span className="items-kind">일정</span>
	                      <h3>
	                        <button type="button" className="items-title-btn" onClick={() => void openEventDetail(event.id)}>
	                          {event.title}
	                        </button>
	                      </h3>
	                      <p>{eventMeta(event)}</p>
                        {countdown && <p className="items-countdown">{countdown}</p>}
	                    </div>
                    <div className="items-card-actions">
                      <span className="items-status">{EVENT_STATUS_LABEL[event.status ?? ""] ?? "상태 없음"}</span>
                      {event.threadId != null && <a href={`/threads/${event.threadId}`}>스레드</a>}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="items-section" aria-labelledby="items-tasks-title">
            <div className="items-section-head">
              <h2 id="items-tasks-title">할 일</h2>
              <span>{data.tasks.length}</span>
            </div>
            {data.tasks.length === 0 ? (
              <p className="items-empty-line">보이는 할 일이 없어.</p>
            ) : (
              <ul className="items-list" role="list">
                {data.tasks.map((task) => {
                  const countdown = taskCountdown(task, nowMs);
                  return (
	                  <li className="items-card" key={task.id}>
	                    <div>
	                      <span className="items-kind">할 일</span>
	                      <h3>
	                        <button type="button" className="items-title-btn" onClick={() => openTaskDetail(task)}>
	                          {task.title}
	                        </button>
	                      </h3>
	                      <p>{taskMeta(task)}</p>
                        {countdown && <p className="items-countdown">{countdown}</p>}
	                    </div>
                    <div className="items-card-actions">
                      <span className="items-status">{TASK_STATUS_LABEL[task.status ?? ""] ?? "상태 없음"}</span>
                      {task.threadId != null && <a href={`/threads/${task.threadId}`}>스레드</a>}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {eventSheet && (
        <>
          <div className="sheet-backdrop" aria-hidden="true" onClick={() => setEventSheet(null)} />
          <div role="dialog" aria-modal="true" aria-label="일정 상세" className="sheet sheet--entering">
            <span className="sheet-handle" aria-hidden="true" />
            <button className="sheet-close-btn" onClick={() => setEventSheet(null)} aria-label="닫기">✕</button>
            {eventSheet.tag === "loading" && <p className="event-detail-loading">불러오는 중…</p>}
            {eventSheet.tag === "error" && <p className="sheet-error" role="alert">{eventSheet.message}</p>}
            {eventSheet.tag === "loaded" && (
              <div className="item-detail-sheet">
                <header className="item-detail-header">
                  <span className="items-kind">일정</span>
                  <h2>{eventSheet.data.event.title}</h2>
                  <p>{formatEventTime(eventSheet.data.event)}</p>
                  {eventCountdown(eventSheet.data.event, nowMs) && <p className="items-countdown">{eventCountdown(eventSheet.data.event, nowMs)}</p>}
                  {eventSheet.data.event.location && <p>{eventSheet.data.event.location}</p>}
                  {eventSheet.data.thread && <a href={`/threads/${eventSheet.data.thread.id}`}>{eventSheet.data.thread.name}</a>}
                </header>
                <section className="item-detail-actions" aria-labelledby="event-slot-title">
                  <p id="event-slot-title" className="event-detail-section-label">시간 추천</p>
                  {eventSheet.data.event.source === "gcal" ? (
                    <p className="card-meta">외부 일정은 Cairn에서 시간을 바꾸지 않아.</p>
                  ) : eventSheet.data.event.start != null ? (
                    <p className="card-meta">이미 시간이 있어. 미정 일정만 여기서 배정해.</p>
                  ) : (
                    <EventSlotControls
                      state={eventSlotState[eventSheet.eventId] ?? { tag: "idle" }}
                      onLoad={() => void loadEventSlots(eventSheet.eventId)}
                      onPick={(candidate) => void applyEventSlot(eventSheet.eventId, candidate)}
                    />
                  )}
                </section>
                <section className="item-detail-actions" aria-labelledby="event-status-title">
                  <p id="event-status-title" className="event-detail-section-label">결과</p>
                  <div className="item-detail-status-grid">
                    {EVENT_STATUS_ACTIONS.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className="item-detail-status-btn"
                        aria-pressed={eventSheet.data.event.status === status}
                        disabled={eventSheet.saving != null || eventSheet.data.event.status === status}
                        onClick={() => void updateEventStatus(status)}
                      >
                        {eventSheet.saving === status ? "…" : EVENT_STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                  {eventSheet.error && <p className="sheet-error" role="alert">{eventSheet.error}</p>}
                </section>
                {eventSheet.data.people.length > 0 && (
                  <section className="item-detail-section" aria-labelledby="event-people-title">
                    <p id="event-people-title" className="event-detail-section-label">참석자</p>
                    <ul className="item-detail-list" role="list">
                      {eventSheet.data.people.map((p) => <li key={p.id}>{p.name}{p.relation ? ` (${p.relation})` : ""}</li>)}
                    </ul>
                  </section>
                )}
                {eventSheet.data.annotations.length > 0 && (
                  <section className="item-detail-section" aria-labelledby="event-notes-title">
                    <p id="event-notes-title" className="event-detail-section-label">메모</p>
                    <ul className="item-detail-list" role="list">
                      {eventSheet.data.annotations.map((a) => <li key={a.id}>{a.reasonText}</li>)}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {taskSheet && (
        <>
          <div className="sheet-backdrop" aria-hidden="true" onClick={() => setTaskSheet(null)} />
          <div role="dialog" aria-modal="true" aria-label="할 일 상세" className="sheet sheet--entering">
            <span className="sheet-handle" aria-hidden="true" />
            <button className="sheet-close-btn" onClick={() => setTaskSheet(null)} aria-label="닫기">✕</button>
            <div className="item-detail-sheet">
              <header className="item-detail-header">
                <span className="items-kind">할 일</span>
                <h2>{taskSheet.task.title}</h2>
                <p>{taskMeta(taskSheet.task)}</p>
                {taskCountdown(taskSheet.task, nowMs) && <p className="items-countdown">{taskCountdown(taskSheet.task, nowMs)}</p>}
                {taskSheet.task.context && <p>{taskSheet.task.context}</p>}
                {taskSheet.task.threadId != null && <a href={`/threads/${taskSheet.task.threadId}`}>스레드 #{taskSheet.task.threadId}</a>}
              </header>
              <section className="item-detail-actions" aria-labelledby="task-slot-title">
                <p id="task-slot-title" className="event-detail-section-label">시간 추천</p>
                {taskSheet.task.due == null ? (
                  <p className="card-meta">마감일을 먼저 넣어야 후보를 계산할 수 있어.</p>
                ) : (
                  <TaskSlotControls
                    state={taskSlotState[taskSheet.task.id] ?? { tag: "idle" }}
                    onLoad={() => void loadTaskSlots(taskSheet.task)}
                    onPick={(candidate) => void applyTaskSlot(taskSheet.task, candidate)}
                  />
                )}
              </section>
              <section className="item-detail-actions" aria-labelledby="task-status-title">
                <p id="task-status-title" className="event-detail-section-label">상태</p>
                <div className="item-detail-status-grid">
                  {TASK_STATUS_ACTIONS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="item-detail-status-btn"
                      aria-pressed={taskSheet.task.status === status}
                      disabled={taskSheet.saving != null || taskSheet.task.status === status}
                      onClick={() => void updateTaskStatus(status)}
                    >
                      {taskSheet.saving === status ? "…" : TASK_STATUS_LABEL[status]}
                    </button>
                  ))}
                </div>
                {taskSheet.error && <p className="sheet-error" role="alert">{taskSheet.error}</p>}
              </section>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function EventSlotControls({
  state,
  onLoad,
  onPick
}: {
  state: EventSlotState;
  onLoad: () => void;
  onPick: (candidate: SlotCandidate) => void;
}) {
  if (state.tag === "loading") return <p className="today-slot-loading">후보 찾는 중...</p>;
  if (state.tag === "error") return <p className="today-slot-error" role="alert">{state.message}</p>;
  if (state.tag === "loaded" || state.tag === "applying") {
    return (
      <>
        {state.tag === "applying" && <p className="today-slot-loading">배정 중...</p>}
        <SlotCandidatePicker
          candidates={state.candidates}
          emptyMessage="빈 시간이 없어. 나중에 다시 해봐."
          onPick={onPick}
          testIdPrefix="item-event-slot"
        />
      </>
    );
  }
  return <button type="button" className="today-slot-btn" onClick={onLoad}>시간 추천</button>;
}

function TaskSlotControls({
  state,
  onLoad,
  onPick
}: {
  state: TaskSlotState;
  onLoad: () => void;
  onPick: (candidate: SlotCandidate) => void;
}) {
  if (state.tag === "loading") return <p className="today-slot-loading">후보 찾는 중...</p>;
  if (state.tag === "error") return <p className="today-slot-error" role="alert">{state.message}</p>;
  if (state.tag === "loaded" || state.tag === "applying") {
    return (
      <>
        <p className="card-meta">선택하면 작업 블록을 만들어. 완료 처리는 아님.</p>
        {state.tag === "applying" && <p className="today-slot-loading">만드는 중...</p>}
        <SlotCandidatePicker
          candidates={state.candidates}
          emptyMessage="빈 시간이 없어. 나중에 다시 해봐."
          onPick={onPick}
          testIdPrefix="item-task-slot"
        />
      </>
    );
  }
  return <button type="button" className="today-slot-btn" onClick={onLoad}>시간 추천</button>;
}
