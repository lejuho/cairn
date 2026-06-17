import { useCallback, useEffect, useRef, useState } from "react";
import type { TodaySurface } from "@cairn/shared";

type ReplyState = { text: string; error: string | null; submitting: boolean };

type SheetMode = "task" | "event";
type TaskForm = { title: string; estMinutes: string };
type EventForm = { title: string; start: string; end: string };
type SheetState =
  | { open: false }
  | { open: true; mode: SheetMode; taskForm: TaskForm; eventForm: EventForm; submitting: boolean; error: string | null };

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet" }
  | { tag: "live"; surface: TodaySurface }
  | { tag: "error"; message: string };

const EMPTY_TASK_FORM: TaskForm = { title: "", estMinutes: "2" };
const EMPTY_EVENT_FORM: EventForm = { title: "", start: "", end: "" };

function datetimeLocalToRfc3339(value: string): string {
  // getTimezoneOffset() returns minutes-west; KST=-540 → sign "+"
  const offsetMinutesWest = new Date().getTimezoneOffset();
  const sign = offsetMinutesWest <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutesWest);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${value}:00${sign}${hh}:${mm}`;
}

function localDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

async function createTask(title: string, estMinutes: number): Promise<void> {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, estMinutes })
  });
  if (!res.ok) throw new Error("작업 생성 실패");
}

async function createEvent(title: string, start: string, end: string): Promise<void> {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, start, end })
  });
  if (!res.ok) throw new Error("일정 생성 실패");
}

export function Today() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [replyState, setReplyState] = useState<Record<number, ReplyState>>({});
  const [sheet, setSheet] = useState<SheetState>({ open: false });
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
      setSheet((prev) => prev.open ? { ...prev, submitting: true, error: null } : prev);
      try {
        await createTask(title, estMinutes);
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
      setSheet((prev) => prev.open ? { ...prev, submitting: true, error: null } : prev);
      try {
        await createEvent(title, start, end);
        setSheet({ open: false });
        await refresh();
      } catch (e) {
        setSheet((prev) => prev.open ? { ...prev, submitting: false, error: e instanceof Error ? e.message : "오류" } : prev);
      }
    }
  }, [sheet, refresh]);

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
          </section>
        </main>
        {sheetEl}
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
                <p className="card-title">{card.event.title}</p>
                <p className="card-meta">
                  {card.event.start?.slice(11, 16)} — {card.event.end?.slice(11, 16)}
                </p>
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

          return null;
        })}
      </ul>
      </main>
      {sheetEl}
    </>
  );
}
