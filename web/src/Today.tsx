import { useCallback, useEffect, useRef, useState } from "react";
import type { EventDetailData, SlotCandidate, ThreadSummary, TodaySurface } from "@cairn/shared";
import { datetimeLocalToRfc3339, localDateString } from "./dateUtils.js";

type ReplyState = { text: string; error: string | null; submitting: boolean };
type EventDetailState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "loaded"; data: EventDetailData }
  | { tag: "error"; message: string };
type DetailNoteState = { text: string; submitting: boolean; error: string | null };
type SlotState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "loaded"; candidates: SlotCandidate[] }
  | { tag: "error"; message: string };
type SlotStateMap = Record<number, SlotState>;

type SheetMode = "task" | "event";
type TaskForm = { title: string; estMinutes: string; threadId: string };
type EventForm = { title: string; start: string; end: string; threadId: string };
type SheetState =
  | { open: false }
  | { open: true; mode: SheetMode; taskForm: TaskForm; eventForm: EventForm; submitting: boolean; error: string | null };

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet" }
  | { tag: "live"; surface: TodaySurface }
  | { tag: "error"; message: string };

const EMPTY_TASK_FORM: TaskForm = { title: "", estMinutes: "2", threadId: "" };
const EMPTY_EVENT_FORM: EventForm = { title: "", start: "", end: "", threadId: "" };


async function loadSurface(): Promise<TodaySurface> {
  const date = localDateString();
  const now = new Date().toISOString();
  const res = await fetch(`/api/today?date=${date}&now=${encodeURIComponent(now)}`);
  const body = (await res.json()) as { ok: boolean; data?: TodaySurface; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

async function markTaskDone(id: number): Promise<void> {
  const res = await fetch(`/api/tasks/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  if (!res.ok) throw new Error("완료 처리 실패");
}

async function submitAnnotation(eventId: number, text: string): Promise<void> {
  const res = await fetch(`/api/events/${eventId}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error("제출 실패");
}

async function loadThreadOptions(): Promise<ThreadSummary[]> {
  try {
    const res = await fetch("/api/threads");
    const body = (await res.json()) as { ok: boolean; data?: ThreadSummary[] };
    return body.ok ? (body.data ?? []) : [];
  } catch {
    return [];
  }
}

async function createTask(title: string, estMinutes: number, threadId?: number): Promise<void> {
  const payload: Record<string, unknown> = { title, estMinutes };
  if (threadId != null) payload.threadId = threadId;
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("작업 생성 실패");
}

type QuickCaptureResult = { captureStatus: "scheduled" | "unscheduled" | "raw_stored" };

async function flatCapture(text: string): Promise<QuickCaptureResult> {
  const now = new Date().toISOString().replace("Z", "+00:00");
  const res = await fetch("/api/capture/flat-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, now })
  });
  const body = (await res.json()) as { ok: boolean; data?: QuickCaptureResult; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "캡처 실패");
  return body.data!;
}

async function fetchEventDetail(id: number): Promise<EventDetailData> {
  const res = await fetch(`/api/events/${id}`);
  const body = (await res.json()) as { ok: boolean; data?: EventDetailData; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "불러오기 실패");
  return body.data!;
}

async function patchStatus(id: number, status: string): Promise<void> {
  const res = await fetch(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error("상태 변경 실패");
}

async function createEvent(title: string, start: string, end: string, threadId?: number): Promise<void> {
  const payload: Record<string, unknown> = { title, start, end };
  if (threadId != null) payload.threadId = threadId;
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("일정 생성 실패");
}

export function Today() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [replyState, setReplyState] = useState<Record<number, ReplyState>>({});
  const [slotState, setSlotState] = useState<SlotStateMap>({});
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [threadOptions, setThreadOptions] = useState<ThreadSummary[]>([]);
  const [capture, setCapture] = useState<{ text: string; submitting: boolean; savedMsg: string | null }>({
    text: "", submitting: false, savedMsg: null
  });
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetailState>({ tag: "idle" });
  const [detailNote, setDetailNote] = useState<DetailNoteState>({ text: "", submitting: false, error: null });
  const savedMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setView({ tag: "loading" });
    try {
      const surface = await loadSurface();
      setView(
        surface.state === "quiet"
          ? { tag: "quiet" }
          : { tag: "live", surface }
      );
    } catch (e) {
      setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSheet = useCallback((mode: SheetMode) => {
    setSheet({ open: true, mode, taskForm: EMPTY_TASK_FORM, eventForm: EMPTY_EVENT_FORM, submitting: false, error: null });
    void loadThreadOptions().then(setThreadOptions);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet({ open: false });
  }, []);

  useEffect(() => {
    if (sheet.open) {
      const t = setTimeout(() => firstInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [sheet.open]);

  const handleSheetSubmit = useCallback(async () => {
    if (!sheet.open || sheet.submitting) return;

    if (sheet.mode === "task") {
      const title = sheet.taskForm.title.trim();
      if (!title) return;
      const parsed = parseInt(sheet.taskForm.estMinutes, 10);
      const estMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
      const threadIdParsed = sheet.taskForm.threadId ? parseInt(sheet.taskForm.threadId, 10) : undefined;
      const threadId = threadIdParsed != null && Number.isFinite(threadIdParsed) ? threadIdParsed : undefined;
      setSheet((prev) => prev.open ? { ...prev, submitting: true, error: null } : prev);
      try {
        await createTask(title, estMinutes, threadId);
        setSheet({ open: false });
        await refresh();
      } catch (e) {
        setSheet((prev) => prev.open ? { ...prev, submitting: false, error: e instanceof Error ? e.message : "오류" } : prev);
      }
    } else {
      const title = sheet.eventForm.title.trim();
      const startRaw = sheet.eventForm.start;
      const endRaw = sheet.eventForm.end;
      if (!title || !startRaw || !endRaw) return;
      if (endRaw <= startRaw) return;
      const start = datetimeLocalToRfc3339(startRaw);
      const end = datetimeLocalToRfc3339(endRaw);
      const threadIdParsed = sheet.eventForm.threadId ? parseInt(sheet.eventForm.threadId, 10) : undefined;
      const threadId = threadIdParsed != null && Number.isFinite(threadIdParsed) ? threadIdParsed : undefined;
      setSheet((prev) => prev.open ? { ...prev, submitting: true, error: null } : prev);
      try {
        await createEvent(title, start, end, threadId);
        setSheet({ open: false });
        await refresh();
      } catch (e) {
        setSheet((prev) => prev.open ? { ...prev, submitting: false, error: e instanceof Error ? e.message : "오류" } : prev);
      }
    }
  }, [sheet, refresh]);

  const handleCapture = useCallback(async () => {
    if (!capture.text.trim() || capture.submitting) return;
    setCapture((c) => ({ ...c, submitting: true, savedMsg: null }));
    if (savedMsgTimer.current) clearTimeout(savedMsgTimer.current);
    try {
      const result = await flatCapture(capture.text.trim());
      setCapture((c) => ({
        ...c, text: "", submitting: false,
        savedMsg: result.captureStatus === "scheduled" ? null : "날짜 없이 저장됐어"
      }));
      if (result.captureStatus !== "scheduled") {
        savedMsgTimer.current = setTimeout(() => setCapture((c) => ({ ...c, savedMsg: null })), 4000);
      }
      await refresh();
    } catch {
      setCapture((c) => ({ ...c, submitting: false, savedMsg: null }));
    }
  }, [capture, refresh]);

  const handleLoadCandidates = useCallback(async (eventId: number) => {
    setSlotState((s) => ({ ...s, [eventId]: { tag: "loading" } }));
    try {
      const now = new Date().toISOString().replace("Z", "+00:00");
      const date = now.slice(0, 10);
      const res = await fetch(
        `/api/events/${eventId}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=7`
      );
      const body = (await res.json()) as { ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } };
      if (!body.ok) throw new Error(body.error?.message ?? "후보 로딩 실패");
      setSlotState((s) => ({ ...s, [eventId]: { tag: "loaded", candidates: body.data!.candidates } }));
    } catch (e) {
      setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
    }
  }, []);

  const handleSchedule = useCallback(async (eventId: number, start: string, end: string) => {
    try {
      const res = await fetch(`/api/events/${eventId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end })
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!body.ok) {
        setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: body.error?.message ?? "일정 저장 실패" } }));
        return;
      }
      setSlotState((s) => ({ ...s, [eventId]: { tag: "idle" } }));
      await refresh();
    } catch {
      setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: "일정 저장 실패" } }));
    }
  }, [refresh]);

  const handleReply = useCallback(
    async (eventId: number) => {
      const rs = replyState[eventId] ?? { text: "", error: null, submitting: false };
      if (!rs.text.trim()) return;
      setReplyState((prev) => ({
        ...prev,
        [eventId]: { text: rs.text, error: null, submitting: true }
      }));
      try {
        await submitAnnotation(eventId, rs.text);
        await refresh();
      } catch (e) {
        setReplyState((prev) => ({
          ...prev,
          [eventId]: {
            text: rs.text,
            error: e instanceof Error ? e.message : "오류",
            submitting: false
          }
        }));
      }
    },
    [replyState, refresh]
  );

  const handleDone = useCallback(
    async (taskId: number) => {
      try {
        await markTaskDone(taskId);
        await refresh();
      } catch {
        // noop — refresh will show current state
      }
    },
    [refresh]
  );

  const handleCloseEventDetail = useCallback(() => {
    setSelectedEventId(null);
    setEventDetail({ tag: "idle" });
    setDetailNote({ text: "", submitting: false, error: null });
  }, []);

  const handleOpenEventDetail = useCallback(async (id: number) => {
    setSelectedEventId(id);
    setEventDetail({ tag: "loading" });
    setDetailNote({ text: "", submitting: false, error: null });
    try {
      const data = await fetchEventDetail(id);
      setEventDetail({ tag: "loaded", data });
    } catch (e) {
      setEventDetail({ tag: "error", message: e instanceof Error ? e.message : "오류" });
    }
  }, []);

  const handlePatchStatus = useCallback(async (status: string) => {
    if (selectedEventId == null) return;
    try {
      await patchStatus(selectedEventId, status);
      handleCloseEventDetail();
      await refresh();
    } catch {
      // noop — sheet stays open
    }
  }, [selectedEventId, handleCloseEventDetail, refresh]);

  const handleDetailNote = useCallback(async () => {
    if (selectedEventId == null || detailNote.submitting || !detailNote.text.trim()) return;
    setDetailNote((n) => ({ ...n, submitting: true, error: null }));
    try {
      await submitAnnotation(selectedEventId, detailNote.text);
      setDetailNote({ text: "", submitting: false, error: null });
      const data = await fetchEventDetail(selectedEventId);
      setEventDetail({ tag: "loaded", data });
    } catch (e) {
      setDetailNote((n) => ({ ...n, submitting: false, error: e instanceof Error ? e.message : "오류" }));
    }
  }, [selectedEventId, detailNote]);

  const eventDetailSheetEl = selectedEventId != null ? (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={handleCloseEventDetail} />
      <div role="dialog" aria-modal="true" aria-label="일정 상세" className="sheet sheet--entering">
        <span className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close-btn" onClick={handleCloseEventDetail} aria-label="닫기">✕</button>
        {eventDetail.tag === "loading" && <p className="event-detail-loading">불러오는 중…</p>}
        {eventDetail.tag === "error" && <p className="sheet-error" role="alert">{eventDetail.message}</p>}
        {eventDetail.tag === "loaded" && (
          <>
            <div className="event-detail-header">
              <p className="event-detail-title">{eventDetail.data.event.title}</p>
              {(eventDetail.data.event.start || eventDetail.data.event.end) && (
                <p className="event-detail-time">
                  {eventDetail.data.event.start?.slice(11, 16)}
                  {eventDetail.data.event.end ? ` — ${eventDetail.data.event.end.slice(11, 16)}` : ""}
                </p>
              )}
              {eventDetail.data.thread && (
                <p className="event-detail-thread">{eventDetail.data.thread.name}</p>
              )}
            </div>
            {eventDetail.data.people.length > 0 && (
              <div className="event-detail-people">
                <p className="event-detail-section-label">참석자</p>
                <ul className="event-detail-people-list" role="list">
                  {eventDetail.data.people.map((p) => (
                    <li key={p.id} className="event-detail-person">
                      {p.name}{p.relation ? ` (${p.relation})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="event-detail-actions">
              <p className="event-detail-section-label">결과</p>
              <div className="event-detail-status-btns">
                {(["done", "cancelled", "moved", "late"] as const).map((s) => (
                  <button
                    key={s}
                    className={`event-status-btn${eventDetail.data.event.status === s ? " event-status-btn--active" : ""}`}
                    onClick={() => void handlePatchStatus(s)}
                    aria-label={`상태: ${s === "done" ? "완료" : s === "cancelled" ? "취소" : s === "moved" ? "이동" : "지연"}`}
                    aria-pressed={eventDetail.data.event.status === s}
                  >
                    {s === "done" ? "완료" : s === "cancelled" ? "취소" : s === "moved" ? "이동" : "지연"}
                  </button>
                ))}
              </div>
            </div>
            {eventDetail.data.annotations.length > 0 && (
              <div className="event-detail-annotations">
                <p className="event-detail-section-label">메모</p>
                <ul className="event-detail-annot-list" role="list">
                  {eventDetail.data.annotations.map((a) => (
                    <li key={a.id} className="event-detail-annot">{a.reasonText}</li>
                  ))}
                </ul>
              </div>
            )}
            <form
              className="event-detail-note-form"
              onSubmit={(e) => { e.preventDefault(); void handleDetailNote(); }}
              aria-label="메모 추가"
            >
              <input
                className="today-reply-input"
                value={detailNote.text}
                onChange={(e) => setDetailNote((n) => ({ ...n, text: e.target.value }))}
                disabled={detailNote.submitting}
                placeholder="메모 추가"
                aria-label="메모 입력"
              />
              <button
                type="submit"
                className="today-submit-btn"
                disabled={detailNote.submitting || !detailNote.text.trim()}
                aria-label="메모 제출"
              >
                {detailNote.submitting ? "…" : "→"}
              </button>
            </form>
            {detailNote.error && <p className="sheet-error" role="alert">{detailNote.error}</p>}
          </>
        )}
      </div>
    </>
  ) : null;

  const sheetEl = sheet.open ? (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={closeSheet} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sheet.mode === "task" ? "작업 추가" : "일정 추가"}
        className="sheet sheet--entering"
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-tabs">
          <button
            className={`sheet-tab${sheet.mode === "task" ? " sheet-tab--active" : ""}`}
            onClick={() => setSheet((prev) => prev.open ? { ...prev, mode: "task", error: null } : prev)}
            aria-pressed={sheet.mode === "task"}
          >
            작업 추가
          </button>
          <button
            className={`sheet-tab${sheet.mode === "event" ? " sheet-tab--active" : ""}`}
            onClick={() => setSheet((prev) => prev.open ? { ...prev, mode: "event", error: null } : prev)}
            aria-pressed={sheet.mode === "event"}
          >
            일정 추가
          </button>
        </div>

        {sheet.mode === "task" ? (
          <form onSubmit={(e) => { e.preventDefault(); void handleSheetSubmit(); }} aria-label="작업 추가 폼">
            <div className="sheet-field">
              <label className="sheet-label" htmlFor="task-title">제목</label>
              <input
                id="task-title"
                ref={firstInputRef}
                className="sheet-input"
                value={sheet.taskForm.title}
                onChange={(e) => setSheet((prev) => prev.open ? { ...prev, taskForm: { ...prev.taskForm, title: e.target.value } } : prev)}
                disabled={sheet.submitting}
                placeholder="할 일 이름"
                autoComplete="off"
              />
            </div>
            <div className="sheet-field">
              <label className="sheet-label" htmlFor="task-est">예상 시간 (분)</label>
              <input
                id="task-est"
                className="sheet-input"
                type="number"
                min="1"
                value={sheet.taskForm.estMinutes}
                onChange={(e) => setSheet((prev) => prev.open ? { ...prev, taskForm: { ...prev.taskForm, estMinutes: e.target.value } } : prev)}
                disabled={sheet.submitting}
              />
            </div>
            {threadOptions.length > 0 && (
              <div className="sheet-field">
                <label className="sheet-label" htmlFor="task-thread">스레드 (선택)</label>
                <select
                  id="task-thread"
                  className="sheet-input"
                  value={sheet.taskForm.threadId}
                  onChange={(e) => setSheet((prev) => prev.open ? { ...prev, taskForm: { ...prev.taskForm, threadId: e.target.value } } : prev)}
                  disabled={sheet.submitting}
                  aria-label="스레드 선택"
                >
                  <option value="">— 없음 —</option>
                  {threadOptions.map((s) => (
                    <option key={s.thread.id} value={String(s.thread.id)}>{s.thread.name}</option>
                  ))}
                </select>
              </div>
            )}
            {sheet.error && <p className="sheet-error" role="alert">{sheet.error}</p>}
            <button
              type="submit"
              className="sheet-submit"
              disabled={sheet.submitting || !sheet.taskForm.title.trim()}
              aria-label="작업 저장"
            >
              {sheet.submitting ? "저장 중..." : "저장"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void handleSheetSubmit(); }} aria-label="일정 추가 폼">
            <div className="sheet-field">
              <label className="sheet-label" htmlFor="event-title">제목</label>
              <input
                id="event-title"
                ref={firstInputRef}
                className="sheet-input"
                value={sheet.eventForm.title}
                onChange={(e) => setSheet((prev) => prev.open ? { ...prev, eventForm: { ...prev.eventForm, title: e.target.value } } : prev)}
                disabled={sheet.submitting}
                placeholder="일정 이름"
                autoComplete="off"
              />
            </div>
            <div className="sheet-field">
              <label className="sheet-label" htmlFor="event-start">시작</label>
              <input
                id="event-start"
                className="sheet-input"
                type="datetime-local"
                value={sheet.eventForm.start}
                onChange={(e) => setSheet((prev) => prev.open ? { ...prev, eventForm: { ...prev.eventForm, start: e.target.value } } : prev)}
                disabled={sheet.submitting}
              />
            </div>
            <div className="sheet-field">
              <label className="sheet-label" htmlFor="event-end">종료</label>
              <input
                id="event-end"
                className="sheet-input"
                type="datetime-local"
                value={sheet.eventForm.end}
                onChange={(e) => setSheet((prev) => prev.open ? { ...prev, eventForm: { ...prev.eventForm, end: e.target.value } } : prev)}
                disabled={sheet.submitting}
              />
            </div>
            {threadOptions.length > 0 && (
              <div className="sheet-field">
                <label className="sheet-label" htmlFor="event-thread">스레드 (선택)</label>
                <select
                  id="event-thread"
                  className="sheet-input"
                  value={sheet.eventForm.threadId}
                  onChange={(e) => setSheet((prev) => prev.open ? { ...prev, eventForm: { ...prev.eventForm, threadId: e.target.value } } : prev)}
                  disabled={sheet.submitting}
                  aria-label="스레드 선택"
                >
                  <option value="">— 없음 —</option>
                  {threadOptions.map((s) => (
                    <option key={s.thread.id} value={String(s.thread.id)}>{s.thread.name}</option>
                  ))}
                </select>
              </div>
            )}
            {sheet.error && <p className="sheet-error" role="alert">{sheet.error}</p>}
            <button
              type="submit"
              className="sheet-submit"
              disabled={
                sheet.submitting ||
                !sheet.eventForm.title.trim() ||
                !sheet.eventForm.start ||
                !sheet.eventForm.end ||
                sheet.eventForm.end <= sheet.eventForm.start
              }
              aria-label="일정 저장"
            >
              {sheet.submitting ? "저장 중..." : "저장"}
            </button>
          </form>
        )}
      </div>
    </>
  ) : null;

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="오늘 화면 불러오는 중">
        <div className="today-stack" aria-hidden="true">
          <div className="today-skel" />
          <div className="today-skel today-skel--delay" />
        </div>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-labelledby="today-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Today</p>
          <h1 id="today-title">데이터를 불러오지 못했어</h1>
          <p>서버에 연결되지 않았어. 잠시 후 다시 시도해봐.</p>
          <button className="today-retry" onClick={() => void refresh()}>
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  if (view.tag === "quiet") {
    return (
      <>
        <main className="app-shell" aria-labelledby="today-title">
          <section className="quiet-card warm" data-testid="today-quiet">
            <span className="quiet-dot" aria-hidden="true" />
            <p className="eyebrow">Today</p>
            <h1 id="today-title">오늘은 조용해</h1>
            <p>새로 생기면 올려둘게. 닫고 네 일 해도 돼.</p>
            <button
              className="today-add-btn today-add-btn--cta"
              onClick={() => openSheet("task")}
              aria-label="추가"
            >
              + 추가
            </button>
            <a href="/input" className="today-input-link">직접 입력하러 가기 →</a>
          </section>
          <form
            className="today-capture-form"
            onSubmit={(e) => { e.preventDefault(); void handleCapture(); }}
          >
            <input
              className="today-capture-input"
              value={capture.text}
              onChange={(e) => setCapture((c) => ({ ...c, text: e.target.value }))}
              placeholder="한 줄로 입력해봐 — 내일 3시 치과"
              disabled={capture.submitting}
              aria-label="빠른 입력"
            />
            <button
              type="submit"
              className="today-capture-btn"
              disabled={!capture.text.trim() || capture.submitting}
              aria-label="빠른 입력 저장"
            >
              {capture.submitting ? "…" : "→"}
            </button>
          </form>
          {capture.savedMsg && (
            <p className="today-capture-saved" role="status" aria-live="polite">{capture.savedMsg}</p>
          )}
        </main>
        {sheetEl}
        {eventDetailSheetEl}
      </>
    );
  }

  const { surface } = view;
  return (
    <>
      <main className="app-shell today-live" aria-labelledby="today-sr-title">
        <h2 id="today-sr-title" className="sr-only">
          오늘 ({surface.cards.length}건)
        </h2>
        <div style={{ display: "flex", justifyContent: "flex-end", width: "min(100%, 480px)", marginBottom: "8px" }}>
          <button className="today-add-btn" onClick={() => openSheet("task")} aria-label="추가">
            + 추가
          </button>
        </div>
        <form
          className="today-capture-form"
          onSubmit={(e) => { e.preventDefault(); void handleCapture(); }}
        >
          <input
            className="today-capture-input"
            value={capture.text}
            onChange={(e) => setCapture((c) => ({ ...c, text: e.target.value }))}
            placeholder="한 줄로 입력해봐 — 내일 3시 치과"
            disabled={capture.submitting}
            aria-label="빠른 입력"
          />
          <button
            type="submit"
            className="today-capture-btn"
            disabled={!capture.text.trim() || capture.submitting}
            aria-label="빠른 입력 저장"
          >
            {capture.submitting ? "…" : "→"}
          </button>
        </form>
        {capture.savedMsg && (
          <p className="today-capture-saved" role="status" aria-live="polite">{capture.savedMsg}</p>
        )}
        <ul className="today-stack" role="list">
        {surface.cards.map((card, i) => {
          const delay = { animationDelay: `${i * 55}ms` } as React.CSSProperties;

          if (card.kind === "conflict") {
            return (
              <li key={`conflict-${i}`} className="today-card today-card--conflict" style={delay}>
                <span className="card-chip">충돌</span>
                <p className="card-title">
                  {card.pair.a.title} ↔ {card.pair.b.title}
                </p>
                <p className="card-meta">
                  {card.pair.a.start?.slice(11, 16)} — {card.pair.b.end?.slice(11, 16)}
                </p>
              </li>
            );
          }

          if (card.kind === "watcher") {
            return (
              <li key={`watcher-${i}`} className="today-card today-card--watcher" style={delay}>
                <span className="card-chip">기한</span>
                <p className="card-title">{card.watcher.label}</p>
                <p className="card-meta">{card.watcher.threshold}</p>
              </li>
            );
          }

          if (card.kind === "next_event") {
            return (
              <li key={`next_event-${i}`} className="today-card today-card--event" style={delay}>
                <span className="card-chip">다음 일정</span>
                <button
                  className="today-card-event-btn"
                  onClick={() => void handleOpenEventDetail(card.event.id)}
                  aria-label={`${card.event.title} 상세 보기`}
                >
                  <p className="card-title">{card.event.title}</p>
                  <p className="card-meta">
                    {card.event.start?.slice(11, 16)} — {card.event.end?.slice(11, 16)}
                  </p>
                </button>
              </li>
            );
          }

          if (card.kind === "two_minute_task") {
            return (
              <li key={`task-${i}`} className="today-card today-card--task" style={delay}>
                <span className="card-chip">2분</span>
                <p className="card-title">{card.task.title}</p>
                <button
                  className="today-done-btn"
                  onClick={() => void handleDone(card.task.id)}
                  aria-label={`${card.task.title} 완료`}
                >
                  완료 ✓
                </button>
              </li>
            );
          }

          if (card.kind === "needs_review") {
            const rs = replyState[card.event.id] ?? { text: "", error: null, submitting: false };
            return (
              <li key={`review-${card.event.id}`} className="today-card today-card--review" style={delay}>
                <span className="card-chip">기록</span>
                <p className="card-title">{card.event.title} — 어떻게 됐어?</p>
                <p className="card-meta">
                  {card.event.start?.slice(11, 16)} — {card.event.end?.slice(11, 16)}
                </p>
                <form
                  className="today-reply-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleReply(card.event.id);
                  }}
                >
                  <input
                    className="today-reply-input"
                    aria-label={`${card.event.title} 메모`}
                    value={rs.text}
                    onChange={(e) =>
                      setReplyState((prev) => ({
                        ...prev,
                        [card.event.id]: {
                          text: e.target.value,
                          error: prev[card.event.id]?.error ?? null,
                          submitting: false
                        }
                      }))
                    }
                    disabled={rs.submitting}
                    placeholder="한 줄로 남겨줘"
                  />
                  <button
                    type="submit"
                    className="today-submit-btn"
                    disabled={rs.submitting || !rs.text.trim()}
                    aria-label={`${card.event.title} 메모 제출`}
                  >
                    {rs.submitting ? "..." : "→"}
                  </button>
                </form>
                {rs.error && (
                  <p className="today-reply-error" role="alert">
                    {rs.error}
                  </p>
                )}
              </li>
            );
          }

          if (card.kind === "schedule_prompt") {
            const ss = slotState[card.event.id] ?? { tag: "idle" };
            return (
              <li key={`slot-${card.event.id}`} className="today-card today-card--slot" style={delay}>
                <span className="card-chip">날짜</span>
                <p className="card-title">날짜 잡을까? — {card.event.title}</p>
                {ss.tag === "idle" && (
                  <button
                    className="today-slot-btn"
                    onClick={() => void handleLoadCandidates(card.event.id)}
                    aria-label={`${card.event.title} 날짜 잡기`}
                  >
                    날짜 잡기
                  </button>
                )}
                {ss.tag === "loading" && <p className="today-slot-loading">후보 찾는 중…</p>}
                {ss.tag === "loaded" && ss.candidates.length === 0 && (
                  <p className="today-slot-empty">빈 시간이 없어. 나중에 다시 해봐.</p>
                )}
                {ss.tag === "loaded" && ss.candidates.length > 0 && (
                  <ul className="today-slot-list" role="list">
                    {ss.candidates.map((c, i) => (
                      <li key={i}>
                        <button
                          className="today-slot-candidate"
                          onClick={() => void handleSchedule(card.event.id, c.start, c.end)}
                          aria-label={`${c.start.slice(0, 16)} 선택`}
                        >
                          {c.start.slice(0, 10)} {c.start.slice(11, 16)} – {c.end.slice(11, 16)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {ss.tag === "error" && (
                  <p className="today-slot-error" role="alert">{ss.message}</p>
                )}
              </li>
            );
          }

          return null;
        })}
      </ul>

        {surface.dayEvents.length > 0 && (
          <section className="today-timeline" aria-label="오늘 일정">
            <p className="today-timeline-heading">오늘 일정</p>
            <ul className="today-timeline-list" role="list">
              {surface.dayEvents.map((event) => {
                const nowMs = new Date(surface.now).getTime();
                const startMs = event.start ? new Date(event.start).getTime() : null;
                const endMs = event.end ? new Date(event.end).getTime() : null;
                const isActive = startMs != null && endMs != null && startMs <= nowMs && nowMs < endMs;
                return (
                  <li
                    key={event.id}
                    className={`today-tl-row${isActive ? " today-tl-row--active" : ""}`}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="today-tl-time">
                      {event.start?.slice(11, 16)}
                      {event.end ? ` — ${event.end.slice(11, 16)}` : ""}
                    </span>
                    <button
                      className="today-tl-title today-tl-btn"
                      onClick={() => void handleOpenEventDetail(event.id)}
                      aria-label={`${event.title} 상세 보기`}
                    >
                      {event.title}
                    </button>
                    {event.threadId != null && (
                      <a
                        className="today-tl-link"
                        href={`/threads/${event.threadId}`}
                        aria-label={`${event.title} 스레드`}
                      >
                        ↗
                      </a>
                    )}
                    {event.location && (
                      <span className="today-tl-loc">{event.location}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      {sheetEl}
      {eventDetailSheetEl}
    </>
  );
}
