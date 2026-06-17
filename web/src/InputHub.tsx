import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow, SlotCandidate, ThreadSummary, TodaySurface } from "@cairn/shared";
import { datetimeLocalToRfc3339, localDateString, localNowRfc3339 } from "./dateUtils.js";

// ── types ────────────────────────────────────────────────────────────────────

type HubViewState =
  | { tag: "loading" }
  | { tag: "quiet"; threads: ThreadSummary[] }
  | { tag: "live"; unscheduled: EventRow[]; threads: ThreadSummary[] }
  | { tag: "error"; message: string };

type CaptureState = { text: string; submitting: boolean; savedMsg: string | null; error: string | null };

type EventForm = { title: string; start: string; end: string; threadId: string };
type TaskForm = { title: string; estMinutes: string; threadId: string };

type FormSectionState = {
  mode: "event" | "task";
  eventForm: EventForm;
  taskForm: TaskForm;
  submitting: boolean;
  error: string | null;
  saved: boolean;
};

type SlotMap = Record<number, { tag: "idle" } | { tag: "loading" } | { tag: "loaded"; candidates: SlotCandidate[] } | { tag: "error"; message: string }>;

const EMPTY_EVENT: EventForm = { title: "", start: "", end: "", threadId: "" };
const EMPTY_TASK: TaskForm = { title: "", estMinutes: "", threadId: "" };


// ── component ────────────────────────────────────────────────────────────────

export function InputHub() {
  const [view, setView] = useState<HubViewState>({ tag: "loading" });
  const [capture, setCapture] = useState<CaptureState>({ text: "", submitting: false, savedMsg: null, error: null });
  const [form, setForm] = useState<FormSectionState>({
    mode: "event", eventForm: EMPTY_EVENT, taskForm: EMPTY_TASK,
    submitting: false, error: null, saved: false
  });
  const [slots, setSlots] = useState<SlotMap>({});
  const savedMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setView({ tag: "loading" });
    try {
      const now = localNowRfc3339();
      const date = localDateString();
      const [todayRes, threadsRes] = await Promise.all([
        fetch(`/api/today?date=${date}&now=${encodeURIComponent(now)}`),
        fetch("/api/threads")
      ]);
      const todayBody = (await todayRes.json()) as { ok: boolean; data?: TodaySurface; error?: { message: string } };
      const threadsBody = (await threadsRes.json()) as { ok: boolean; data?: ThreadSummary[]; error?: unknown };
      if (!todayBody.ok) throw new Error(todayBody.error?.message ?? "로드 실패");
      const unscheduled = todayBody.data!.unscheduledEvents ?? [];
      const threads = threadsBody.ok ? (threadsBody.data ?? []) : [];
      if (unscheduled.length === 0) {
        setView({ tag: "quiet", threads });
      } else {
        setView({ tag: "live", unscheduled, threads });
      }
    } catch (e) {
      setView({ tag: "error", message: e instanceof Error ? e.message : "로드 실패" });
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── quick capture ───────────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!capture.text.trim() || capture.submitting) return;
    setCapture((c) => ({ ...c, submitting: true, savedMsg: null, error: null }));
    if (savedMsgTimer.current) clearTimeout(savedMsgTimer.current);
    try {
      const res = await fetch("/api/capture/flat-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: capture.text.trim(), now: localNowRfc3339() })
      });
      const body = (await res.json()) as { ok: boolean; data?: { captureStatus: string }; error?: { message: string } };
      if (!body.ok) throw new Error(body.error?.message ?? "캡처 실패");
      const msg = body.data?.captureStatus === "scheduled" ? "저장됐어" : "날짜 없이 저장됐어";
      setCapture((c) => ({ ...c, text: "", submitting: false, savedMsg: msg, error: null }));
      savedMsgTimer.current = setTimeout(() => setCapture((c) => ({ ...c, savedMsg: null })), 4000);
      await loadData();
    } catch (e) {
      setCapture((c) => ({ ...c, submitting: false, savedMsg: null, error: e instanceof Error ? e.message : "캡처 실패" }));
    }
  }, [capture, loadData]);

  // ── manual add ─────────────────────────────────────────────────────────────

  const handleFormSubmit = useCallback(async () => {
    if (form.submitting) return;
    setForm((f) => ({ ...f, submitting: true, error: null, saved: false }));
    try {
      if (form.mode === "event") {
        const { title, start, end, threadId } = form.eventForm;
        if (!title.trim() || !start || !end) {
          setForm((f) => ({ ...f, submitting: false, error: "제목, 시작, 종료 시간을 입력해줘" }));
          return;
        }
        const payload: Record<string, unknown> = { title: title.trim(), start, end };
        const tid = parseInt(threadId, 10);
        if (tid > 0) payload.threadId = tid;
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const body = (await res.json()) as { ok: boolean; error?: { message: string } };
        if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
        setForm((f) => ({ ...f, eventForm: EMPTY_EVENT, submitting: false, saved: true, error: null }));
      } else {
        const { title, estMinutes, threadId } = form.taskForm;
        if (!title.trim()) {
          setForm((f) => ({ ...f, submitting: false, error: "제목을 입력해줘" }));
          return;
        }
        const payload: Record<string, unknown> = { title: title.trim() };
        const mins = parseInt(estMinutes, 10);
        if (mins > 0) payload.estMinutes = mins;
        const tid = parseInt(threadId, 10);
        if (tid > 0) payload.threadId = tid;
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const body = (await res.json()) as { ok: boolean; error?: { message: string } };
        if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
        setForm((f) => ({ ...f, taskForm: EMPTY_TASK, submitting: false, saved: true, error: null }));
      }
    } catch (e) {
      setForm((f) => ({ ...f, submitting: false, error: e instanceof Error ? e.message : "저장 실패" }));
    }
  }, [form]);

  // ── slot candidates ─────────────────────────────────────────────────────────

  const handleLoadCandidates = useCallback(async (eventId: number) => {
    setSlots((s) => ({ ...s, [eventId]: { tag: "loading" } }));
    try {
      const now = localNowRfc3339();
      const date = localDateString();
      const res = await fetch(`/api/events/${eventId}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=7`);
      const body = (await res.json()) as { ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } };
      if (!body.ok) throw new Error(body.error?.message ?? "후보 로딩 실패");
      setSlots((s) => ({ ...s, [eventId]: { tag: "loaded", candidates: body.data!.candidates } }));
    } catch (e) {
      setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
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
        setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: body.error?.message ?? "일정 저장 실패" } }));
        return;
      }
      setSlots((s) => ({ ...s, [eventId]: { tag: "idle" } }));
      await loadData();
    } catch {
      setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: "일정 저장 실패" } }));
    }
  }, [loadData]);

  // ── render helpers ──────────────────────────────────────────────────────────

  const threads = view.tag === "quiet" ? view.threads : view.tag === "live" ? view.threads : [];

  const captureSection = (
    <section className="input-section">
      <h2 className="input-section-title">빠른 입력</h2>
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
      {capture.error && (
        <p className="input-error" role="alert">{capture.error}</p>
      )}
    </section>
  );

  const formSection = (
    <section className="input-section">
      <h2 className="input-section-title">직접 추가</h2>
      <div className="input-mode-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={form.mode === "event"}
          className={`input-tab${form.mode === "event" ? " input-tab--active" : ""}`}
          onClick={() => setForm((f) => ({ ...f, mode: "event", error: null, saved: false }))}
        >
          일정
        </button>
        <button
          role="tab"
          aria-selected={form.mode === "task"}
          className={`input-tab${form.mode === "task" ? " input-tab--active" : ""}`}
          onClick={() => setForm((f) => ({ ...f, mode: "task", error: null, saved: false }))}
        >
          할 일
        </button>
      </div>

      {form.mode === "event" && (
        <form aria-label="일정 추가 폼" onSubmit={(e) => { e.preventDefault(); void handleFormSubmit(); }}>
          <input
            className="input-field"
            placeholder="제목"
            value={form.eventForm.title}
            onChange={(e) => setForm((f) => ({ ...f, eventForm: { ...f.eventForm, title: e.target.value } }))}
            aria-label="일정 제목"
            disabled={form.submitting}
          />
          <input
            className="input-field"
            type="datetime-local"
            value={form.eventForm.start.slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, eventForm: { ...f.eventForm, start: v ? datetimeLocalToRfc3339(v) : "" } }));
            }}
            aria-label="시작 시간"
            disabled={form.submitting}
          />
          <input
            className="input-field"
            type="datetime-local"
            value={form.eventForm.end.slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, eventForm: { ...f.eventForm, end: v ? datetimeLocalToRfc3339(v) : "" } }));
            }}
            aria-label="종료 시간"
            disabled={form.submitting}
          />
          {threads.length > 0 && (
            <select
              className="input-field"
              value={form.eventForm.threadId}
              onChange={(e) => setForm((f) => ({ ...f, eventForm: { ...f.eventForm, threadId: e.target.value } }))}
              aria-label="스레드"
              disabled={form.submitting}
            >
              <option value="">— 스레드 없음 —</option>
              {threads.map((t) => (
                <option key={t.thread.id} value={String(t.thread.id)}>{t.thread.name}</option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="input-submit-btn"
            disabled={form.submitting}
            aria-label="일정 저장"
          >
            {form.submitting ? "저장 중…" : "저장"}
          </button>
        </form>
      )}

      {form.mode === "task" && (
        <form aria-label="할 일 추가 폼" onSubmit={(e) => { e.preventDefault(); void handleFormSubmit(); }}>
          <input
            className="input-field"
            placeholder="제목"
            value={form.taskForm.title}
            onChange={(e) => setForm((f) => ({ ...f, taskForm: { ...f.taskForm, title: e.target.value } }))}
            aria-label="할 일 제목"
            disabled={form.submitting}
          />
          <input
            className="input-field"
            type="number"
            placeholder="예상 시간 (분)"
            value={form.taskForm.estMinutes}
            onChange={(e) => setForm((f) => ({ ...f, taskForm: { ...f.taskForm, estMinutes: e.target.value } }))}
            aria-label="예상 시간"
            disabled={form.submitting}
          />
          {threads.length > 0 && (
            <select
              className="input-field"
              value={form.taskForm.threadId}
              onChange={(e) => setForm((f) => ({ ...f, taskForm: { ...f.taskForm, threadId: e.target.value } }))}
              aria-label="스레드"
              disabled={form.submitting}
            >
              <option value="">— 스레드 없음 —</option>
              {threads.map((t) => (
                <option key={t.thread.id} value={String(t.thread.id)}>{t.thread.name}</option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="input-submit-btn"
            disabled={form.submitting}
            aria-label="할 일 저장"
          >
            {form.submitting ? "저장 중…" : "저장"}
          </button>
        </form>
      )}

      {form.error && <p className="input-error" role="alert">{form.error}</p>}
      {form.saved && <p className="input-saved" role="status">저장됐어</p>}
    </section>
  );

  function renderUnscheduledSection(unscheduled: EventRow[]) {
    return (
      <section className="input-section" aria-label="미정 일정">
        <h2 className="input-section-title">미정 일정</h2>
        <ul className="input-unscheduled-list" role="list">
          {unscheduled.map((event) => {
            const ss = slots[event.id] ?? { tag: "idle" };
            return (
              <li key={event.id} className="input-unscheduled-item">
                <p className="input-unscheduled-title">{event.title}</p>
                {ss.tag === "idle" && (
                  <button
                    className="today-slot-btn"
                    onClick={() => void handleLoadCandidates(event.id)}
                    aria-label={`${event.title} 날짜 잡기`}
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
                          onClick={() => void handleSchedule(event.id, c.start, c.end)}
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
          })}
        </ul>
      </section>
    );
  }

  // ── states ──────────────────────────────────────────────────────────────────

  if (view.tag === "loading") {
    return (
      <main className="app-shell input-hub" aria-label="입력 허브">
        <p className="input-loading" role="status">불러오는 중…</p>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell input-hub" aria-label="입력 허브">
        <p className="input-error" role="alert" data-testid="input-error">{view.message}</p>
        <button className="input-submit-btn" onClick={() => void loadData()}>다시 시도</button>
      </main>
    );
  }

  if (view.tag === "quiet") {
    return (
      <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-quiet">
        {captureSection}
        {formSection}
      </main>
    );
  }

  return (
    <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-live">
      {captureSection}
      {formSection}
      {renderUnscheduledSection(view.unscheduled)}
    </main>
  );
}
