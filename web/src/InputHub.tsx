import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow, PersonRow, SlotCandidate, ThreadSummary, TodaySurface, Weekday } from "@cairn/shared";
import { datetimeLocalToRfc3339, localDateString, localNowRfc3339 } from "./dateUtils.js";
import { apiJson, type AccessSessionError } from "./api.js";

// ── types ────────────────────────────────────────────────────────────────────

type HubViewState =
  | { tag: "loading" }
  | { tag: "quiet"; threads: ThreadSummary[] }
  | { tag: "live"; unscheduled: EventRow[]; threads: ThreadSummary[] }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

type CaptureState = { text: string; submitting: boolean; savedMsg: string | null; error: string | null };

type EventForm = { title: string; start: string; end: string; threadId: string; personIds: number[] };
type NewPersonState = { show: boolean; name: string; channel: string; relation: string; submitting: boolean; error: string | null };
type ConstraintSheetState = { open: false } | { open: true; personId: number; personName: string; weekdays: Weekday[]; submitting: boolean; error: string | null };

const ALL_WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: "monday", label: "월" }, { key: "tuesday", label: "화" }, { key: "wednesday", label: "수" },
  { key: "thursday", label: "목" }, { key: "friday", label: "금" },
  { key: "saturday", label: "토" }, { key: "sunday", label: "일" }
];
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

const EMPTY_EVENT: EventForm = { title: "", start: "", end: "", threadId: "", personIds: [] };
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
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [newPerson, setNewPerson] = useState<NewPersonState>({ show: false, name: "", channel: "none", relation: "", submitting: false, error: null });
  const [constraintSheet, setConstraintSheet] = useState<ConstraintSheetState>({ open: false });
  const savedMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setView({ tag: "loading" });
    try {
      const now = localNowRfc3339();
      const date = localDateString();
      const [todayBody, threadsBody] = await Promise.allSettled([
        apiJson<{ ok: boolean; data?: TodaySurface; error?: { message: string } }>(
          `/api/today?date=${date}&now=${encodeURIComponent(now)}`
        ),
        apiJson<{ ok: boolean; data?: ThreadSummary[] }>("/api/threads")
      ]);
      if (todayBody.status === "rejected") throw todayBody.reason;
      const today = todayBody.value;
      if (!today.ok) throw new Error(today.error?.message ?? "로드 실패");
      let threads: ThreadSummary[] = [];
      if (threadsBody.status === "fulfilled" && threadsBody.value.ok) {
        threads = threadsBody.value.data ?? [];
      }
      const unscheduled = today.data!.unscheduledEvents ?? [];
      if (unscheduled.length === 0) {
        setView({ tag: "quiet", threads });
      } else {
        setView({ tag: "live", unscheduled, threads });
      }
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setView({ tag: "access_error" });
      } else {
        setView({ tag: "error", message: e instanceof Error ? e.message : "로드 실패" });
      }
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── quick capture ───────────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!capture.text.trim() || capture.submitting) return;
    setCapture((c) => ({ ...c, submitting: true, savedMsg: null, error: null }));
    if (savedMsgTimer.current) clearTimeout(savedMsgTimer.current);
    try {
      const body = await apiJson<{ ok: boolean; data?: { captureStatus: string }; error?: { message: string } }>("/api/capture/flat-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: capture.text.trim(), now: localNowRfc3339() })
      });
      if (!body.ok) throw new Error(body.error?.message ?? "캡처 실패");
      const msg = body.data?.captureStatus === "scheduled" ? "저장됐어" : "날짜 없이 저장됐어";
      setCapture((c) => ({ ...c, text: "", submitting: false, savedMsg: msg, error: null }));
      savedMsgTimer.current = setTimeout(() => setCapture((c) => ({ ...c, savedMsg: null })), 4000);
      await loadData();
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "캡처 실패";
      setCapture((c) => ({ ...c, submitting: false, savedMsg: null, error: msg }));
    }
  }, [capture, loadData]);

  // ── manual add ─────────────────────────────────────────────────────────────

  const handleFormSubmit = useCallback(async () => {
    if (form.submitting) return;
    setForm((f) => ({ ...f, submitting: true, error: null, saved: false }));
    try {
      if (form.mode === "event") {
        const { title, start, end, threadId, personIds } = form.eventForm;
        if (!title.trim() || !start || !end) {
          setForm((f) => ({ ...f, submitting: false, error: "제목, 시작, 종료 시간을 입력해줘" }));
          return;
        }
        const payload: Record<string, unknown> = { title: title.trim(), start, end };
        const tid = parseInt(threadId, 10);
        if (tid > 0) payload.threadId = tid;
        if (personIds.length > 0) payload.personIds = personIds;
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
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
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
        setForm((f) => ({ ...f, taskForm: EMPTY_TASK, submitting: false, saved: true, error: null }));
      }
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "저장 실패";
      setForm((f) => ({ ...f, submitting: false, error: msg }));
    }
  }, [form]);

  // ── slot candidates ─────────────────────────────────────────────────────────

  const handleLoadCandidates = useCallback(async (eventId: number) => {
    setSlots((s) => ({ ...s, [eventId]: { tag: "loading" } }));
    try {
      const now = localNowRfc3339();
      const date = localDateString();
      const body = await apiJson<{ ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } }>(
        `/api/events/${eventId}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=7`
      );
      if (!body.ok) throw new Error(body.error?.message ?? "후보 로딩 실패");
      setSlots((s) => ({ ...s, [eventId]: { tag: "loaded", candidates: body.data!.candidates } }));
    } catch (e) {
      setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
    }
  }, []);

  const handleSchedule = useCallback(async (eventId: number, start: string, end: string) => {
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/events/${eventId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end })
      });
      if (!body.ok) {
        setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: body.error?.message ?? "일정 저장 실패" } }));
        return;
      }
      setSlots((s) => ({ ...s, [eventId]: { tag: "idle" } }));
      await loadData();
    } catch (e) {
      setSlots((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
    }
  }, [loadData]);

  // ── people ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    apiJson<{ ok: boolean; data?: PersonRow[] }>("/api/people")
      .then((body) => { if (body.ok && Array.isArray(body.data)) setPeople(body.data); })
      .catch(() => {}); // best-effort; missing people list degrades gracefully
  }, []);

  const handleAddPerson = useCallback(async () => {
    if (!newPerson.name.trim() || newPerson.submitting) return;
    setNewPerson((s) => ({ ...s, submitting: true, error: null }));
    try {
      const payload: Record<string, unknown> = { displayName: newPerson.name.trim(), channel: newPerson.channel };
      if (newPerson.relation.trim()) payload.relation = newPerson.relation.trim();
      const body = await apiJson<{ ok: boolean; data?: { person: PersonRow }; error?: { message: string } }>("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
      const created = body.data!.person;
      const refreshBody = await apiJson<{ ok: boolean; data?: PersonRow[] }>("/api/people");
      if (refreshBody.ok && Array.isArray(refreshBody.data)) setPeople(refreshBody.data);
      setForm((f) => ({ ...f, eventForm: { ...f.eventForm, personIds: [...f.eventForm.personIds, created.id] } }));
      setNewPerson({ show: false, name: "", channel: "none", relation: "", submitting: false, error: null });
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "저장 실패";
      setNewPerson((s) => ({ ...s, submitting: false, error: msg }));
    }
  }, [newPerson]);

  const handleOpenConstraintSheet = useCallback((person: PersonRow) => {
    const existing = (person.hardConstraints ?? [])
      .filter((c) => c.type === "weekday_unavailable")
      .map((c) => c.weekday as Weekday);
    setConstraintSheet({ open: true, personId: person.id, personName: person.name, weekdays: existing, submitting: false, error: null });
  }, []);

  const handleToggleConstraintWeekday = useCallback((weekday: Weekday) => {
    setConstraintSheet((s) => {
      if (!s.open) return s;
      const next = s.weekdays.includes(weekday) ? s.weekdays.filter((w) => w !== weekday) : [...s.weekdays, weekday];
      return { ...s, weekdays: next };
    });
  }, []);

  const handleSaveConstraints = useCallback(async () => {
    if (!constraintSheet.open || constraintSheet.submitting) return;
    setConstraintSheet((s) => s.open ? { ...s, submitting: true, error: null } : s);
    try {
      const { personId, weekdays } = constraintSheet;
      const body = await apiJson<{ ok: boolean; data?: { person: PersonRow }; error?: { message: string } }>(
        `/api/people/${personId}/hard-constraints`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unavailableWeekdays: weekdays }) }
      );
      if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
      const refreshBody = await apiJson<{ ok: boolean; data?: PersonRow[] }>("/api/people");
      if (refreshBody.ok && Array.isArray(refreshBody.data)) setPeople(refreshBody.data);
      setConstraintSheet({ open: false });
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required"
        ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "저장 실패";
      setConstraintSheet((s) => s.open ? { ...s, submitting: false, error: msg } : s);
    }
  }, [constraintSheet]);

  const togglePerson = useCallback((personId: number) => {
    setForm((f) => {
      const ids = f.eventForm.personIds;
      const next = ids.includes(personId) ? ids.filter((id) => id !== personId) : [...ids, personId];
      return { ...f, eventForm: { ...f.eventForm, personIds: next } };
    });
  }, []);

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
          {people.length > 0 && (
            <fieldset className="input-people-checklist" aria-label="참석자">
              <legend className="input-people-legend">참석자</legend>
              {people.map((p) => (
                <div key={p.id} className="input-person-row">
                  <label className="input-person-label">
                    <input
                      type="checkbox"
                      checked={form.eventForm.personIds.includes(p.id)}
                      onChange={() => togglePerson(p.id)}
                      disabled={form.submitting}
                    />
                    {p.name}
                  </label>
                  <button
                    type="button"
                    className="input-constraint-btn"
                    onClick={() => handleOpenConstraintSheet(p)}
                    aria-label={`${p.name} 요일 제약 설정`}
                    disabled={form.submitting}
                  >
                    제약
                  </button>
                </div>
              ))}
            </fieldset>
          )}
          {!newPerson.show && (
            <button
              type="button"
              className="input-add-person-btn"
              onClick={() => setNewPerson((s) => ({ ...s, show: true }))}
              disabled={form.submitting}
            >
              + 사람 추가
            </button>
          )}
          {newPerson.show && (
            <div className="input-new-person" aria-label="새 사람 추가">
              <input
                className="input-field"
                placeholder="이름"
                value={newPerson.name}
                onChange={(e) => setNewPerson((s) => ({ ...s, name: e.target.value }))}
                disabled={newPerson.submitting}
                aria-label="새 사람 이름"
              />
              <input
                className="input-field"
                placeholder="관계 (선택)"
                value={newPerson.relation}
                onChange={(e) => setNewPerson((s) => ({ ...s, relation: e.target.value }))}
                disabled={newPerson.submitting}
                aria-label="관계"
              />
              <select
                className="input-field"
                value={newPerson.channel}
                onChange={(e) => setNewPerson((s) => ({ ...s, channel: e.target.value }))}
                disabled={newPerson.submitting}
                aria-label="연락 채널"
              >
                <option value="none">채널 없음</option>
                <option value="kakao">카카오</option>
                <option value="sms">문자</option>
                <option value="email">이메일</option>
                <option value="telegram">텔레그램</option>
              </select>
              <div className="input-new-person-actions">
                <button
                  type="button"
                  className="input-submit-btn"
                  onClick={() => void handleAddPerson()}
                  disabled={!newPerson.name.trim() || newPerson.submitting}
                >
                  {newPerson.submitting ? "추가 중…" : "추가"}
                </button>
                <button
                  type="button"
                  className="input-cancel-btn"
                  onClick={() => setNewPerson({ show: false, name: "", channel: "none", relation: "", submitting: false, error: null })}
                  disabled={newPerson.submitting}
                >
                  취소
                </button>
              </div>
              {newPerson.error && <p className="input-error" role="alert">{newPerson.error}</p>}
            </div>
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

  if (view.tag === "access_error") {
    return (
      <main className="app-shell input-hub" aria-label="입력 허브">
        <p className="input-error" role="alert" data-testid="input-error">로그인 세션이 필요해</p>
        <p>Cloudflare Access 세션이 만료됐거나 아직 인증되지 않았어. 다시 로그인한 뒤 이 화면으로 돌아오면 돼.</p>
        <button className="input-submit-btn" onClick={() => { window.location.assign(window.location.href); }}>
          Access 로그인 다시 열기
        </button>
        <button className="input-submit-btn" onClick={() => void loadData()}>다시 시도</button>
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

  const constraintSheetOverlay = constraintSheet.open ? (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={`${constraintSheet.personName} 요일 제약`}>
      <div className="sheet-panel">
        <button className="sheet-close-btn" onClick={() => setConstraintSheet({ open: false })} aria-label="닫기">✕</button>
        <h2 className="sheet-title">{constraintSheet.personName} 요일 제약</h2>
        <p className="constraint-hint">만나기 어려운 요일을 선택해.</p>
        <div className="constraint-weekdays" role="group" aria-label="요일 선택">
          {ALL_WEEKDAYS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`constraint-weekday-btn${constraintSheet.weekdays.includes(key) ? " constraint-weekday-btn--active" : ""}`}
              onClick={() => handleToggleConstraintWeekday(key)}
              aria-pressed={constraintSheet.weekdays.includes(key)}
              disabled={constraintSheet.submitting}
            >
              {label}
            </button>
          ))}
        </div>
        {constraintSheet.error && <p className="input-error" role="alert">{constraintSheet.error}</p>}
        <div className="sheet-actions">
          <button
            className="input-submit-btn"
            onClick={() => void handleSaveConstraints()}
            disabled={constraintSheet.submitting}
            aria-label="제약 저장"
          >
            {constraintSheet.submitting ? "저장 중…" : "저장"}
          </button>
          <button
            className="input-cancel-btn"
            onClick={() => setConstraintSheet({ open: false })}
            disabled={constraintSheet.submitting}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (view.tag === "quiet") {
    return (
      <>
        <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-quiet">
          {captureSection}
          {formSection}
        </main>
        {constraintSheetOverlay}
      </>
    );
  }

  return (
    <>
      <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-live">
        {captureSection}
        {formSection}
        {renderUnscheduledSection(view.unscheduled)}
      </main>
      {constraintSheetOverlay}
    </>
  );
}
