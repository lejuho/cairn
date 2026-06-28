import { useCallback, useEffect, useState } from "react";
import type { CreateThreadDraftResponseData, EventMode, EventRow, PersonRow, SlotCandidate, ThreadSummary, TodaySurface, Weekday } from "@cairn/shared";
import { datetimeLocalToRfc3339, localDateString, localNowRfc3339 } from "./dateUtils.js";
import { apiJson, type AccessSessionError } from "./api.js";
import { ResultCard } from "./ResultCard.js";
import { CreationComposer, type ComposerMode } from "./CreationComposer.js";
import { WatcherFieldsPanel, RecordTargetSelect, createWatcher, createRecord, dedupeTargets, watcherSubtypeValid, EMPTY_WATCHER_FIELDS, type WatcherSubtype, type WatcherFields, type RecordTarget } from "./composerModes.js";

// ── types ────────────────────────────────────────────────────────────────────

type HubViewState =
  | { tag: "loading" }
  | { tag: "quiet"; threads: ThreadSummary[] }
  | { tag: "live"; unscheduled: EventRow[]; threads: ThreadSummary[] }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

// Composer (cycle-69). One central input + an explicit mode that alone selects
// the endpoint (no classifier): event→capture, thread→thread-draft, task→tasks.
// `result` is a discriminated union driving the cycle-68 ResultCard per mode.
// (ComposerMode moved to CreationComposer.tsx, cycle-70.)
type ComposerResult =
  | { kind: "capture"; scheduled: boolean }
  | { kind: "thread"; draft: CreateThreadDraftResponseData }
  | { kind: "task" }
  | { kind: "watcher"; label: string } // cycle-71
  | { kind: "record"; eventTitle: string; parseStatus: "parsed" | "raw_stored" }; // cycle-71
type ComposerState = { mode: ComposerMode; text: string; submitting: boolean; error: string | null; result: ComposerResult | null };

type EventForm = { title: string; start: string; end: string; threadId: string; personIds: number[]; eventMode: EventMode | null };
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

const EMPTY_EVENT: EventForm = { title: "", start: "", end: "", threadId: "", personIds: [], eventMode: null };

const EVENT_MODE_CHIPS: { value: EventMode; label: string }[] = [
  { value: "in_person", label: "대면" },
  { value: "remote", label: "비대면" },
  { value: "async", label: "과제" }
];
const EMPTY_TASK: TaskForm = { title: "", estMinutes: "", threadId: "" };


// ── component ────────────────────────────────────────────────────────────────

export function InputHub() {
  const [view, setView] = useState<HubViewState>({ tag: "loading" });
  const [composer, setComposer] = useState<ComposerState>({ mode: "event", text: "", submitting: false, error: null, result: null });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Watcher/record Composer modes (cycle-71).
  const [watcherSubtype, setWatcherSubtype] = useState<WatcherSubtype>("date_threshold");
  const [watcherFields, setWatcherFields] = useState<WatcherFields>(EMPTY_WATCHER_FIELDS);
  const [recordTargets, setRecordTargets] = useState<RecordTarget[]>([]);
  const [recordTargetId, setRecordTargetId] = useState<number | null>(null);
  const [form, setForm] = useState<FormSectionState>({
    mode: "event", eventForm: EMPTY_EVENT, taskForm: EMPTY_TASK,
    submitting: false, error: null, saved: false
  });
  const [slots, setSlots] = useState<SlotMap>({});
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [newPerson, setNewPerson] = useState<NewPersonState>({ show: false, name: "", channel: "none", relation: "", submitting: false, error: null });
  const [constraintSheet, setConstraintSheet] = useState<ConstraintSheetState>({ open: false });

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
      // Record-mode targets (cycle-71): scheduled day events + unscheduled Cairn events.
      setRecordTargets(dedupeTargets([...(today.data!.dayEvents ?? []), ...unscheduled]));
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

  // ── composer (cycle-69) ──────────────────────────────────────────────────────

  const handleComposerSubmit = useCallback(async () => {
    const text = composer.text.trim();
    if (!text || composer.submitting) return;
    setComposer((c) => ({ ...c, submitting: true, error: null, result: null }));
    try {
      if (composer.mode === "event") {
        const body = await apiJson<{ ok: boolean; data?: { captureStatus: string }; error?: { message: string } }>("/api/capture/flat-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, now: localNowRfc3339() })
        });
        if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
        const scheduled = body.data?.captureStatus === "scheduled";
        setComposer((c) => ({ ...c, text: "", submitting: false, result: { kind: "capture", scheduled }, error: null }));
        await loadData(); // a new unscheduled event must appear in the /input list
      } else if (composer.mode === "thread") {
        const body = await apiJson<{ ok: boolean; data?: CreateThreadDraftResponseData; error?: { message: string } }>("/api/threads/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        if (!body.ok || !body.data) throw new Error(body.error?.message ?? "초안 생성 실패");
        setComposer((c) => ({ ...c, text: "", submitting: false, result: { kind: "thread", draft: body.data! }, error: null }));
      } else if (composer.mode === "task") {
        // task — title-only in this A-slice (estimate/due/thread stay in 고급 입력)
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: text })
        });
        if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
        setComposer((c) => ({ ...c, text: "", submitting: false, result: { kind: "task" }, error: null }));
      } else if (composer.mode === "watcher") {
        // watcher (cycle-71): central text is the label; subtype picks the endpoint.
        await createWatcher(watcherSubtype, text, watcherFields);
        setComposer((c) => ({ ...c, text: "", submitting: false, result: { kind: "watcher", label: text }, error: null }));
        setWatcherFields(EMPTY_WATCHER_FIELDS);
        await loadData();
      } else {
        // record (cycle-71): event-linked annotation; target chosen explicitly.
        if (recordTargetId == null) return; // gated by submitDisabled
        const { parseStatus } = await createRecord(recordTargetId, text);
        const eventTitle = recordTargets.find((t) => t.id === recordTargetId)?.title ?? "이벤트";
        setComposer((c) => ({ ...c, text: "", submitting: false, result: { kind: "record", eventTitle, parseStatus }, error: null }));
        await loadData();
      }
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "저장 실패";
      setComposer((c) => ({ ...c, submitting: false, error: msg }));
    }
  }, [composer, loadData, watcherSubtype, watcherFields, recordTargetId, recordTargets]);

  // ── manual add ─────────────────────────────────────────────────────────────

  const handleFormSubmit = useCallback(async () => {
    if (form.submitting) return;
    setForm((f) => ({ ...f, submitting: true, error: null, saved: false }));
    try {
      if (form.mode === "event") {
        const { title, start, end, threadId, personIds, eventMode } = form.eventForm;
        if (!title.trim() || !start || !end) {
          setForm((f) => ({ ...f, submitting: false, error: "제목, 시작, 종료 시간을 입력해줘" }));
          return;
        }
        const payload: Record<string, unknown> = { title: title.trim(), start, end };
        const tid = parseInt(threadId, 10);
        if (tid > 0) payload.threadId = tid;
        if (personIds.length > 0) payload.personIds = personIds;
        if (eventMode != null) payload.mode = eventMode;
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

  const COMPOSER_MODES: { mode: ComposerMode; label: string; placeholder: string }[] = [
    { mode: "event", label: "일정", placeholder: "내일 3시 치과 — 한 줄로 적으면 일정으로 잡아줄게" },
    { mode: "thread", label: "스레드", placeholder: "예: 6월 파리 여행 준비. 항공권 예약하고 여권 유효기간 확인." },
    { mode: "task", label: "할 일", placeholder: "할 일 제목 — 예: 코드 리뷰" },
    { mode: "watcher", label: "Watcher", placeholder: "지켜볼 것 이름 — 예: 여권 갱신" },
    { mode: "record", label: "기록", placeholder: "무슨 일이 있었는지 적어줘 — 이벤트에 기록돼" }
  ];
  const composerResultCard = (() => {
    const r = composer.result;
    if (!r) return null;
    if (r.kind === "capture") {
      return (
        <ResultCard
          kind={r.scheduled ? "일정" : "미정 일정"}
          status={r.scheduled ? "저장됐어" : "날짜 없이 저장됐어"}
          primary={r.scheduled
            ? { label: "Today에서 보기", href: "/today" }
            : { label: "날짜 잡기", onClick: () => { setComposer((c) => ({ ...c, result: null })); void loadData(); } }}
          secondary={r.scheduled
            ? "방금 만든 일정은 오늘 화면에서 볼 수 있어."
            : "날짜를 잡으면 일정으로 확정돼 — 아래 미정 일정 목록에서 잡을 수 있어."}
          testId="capture-result"
        />
      );
    }
    if (r.kind === "thread") {
      return (
        <ResultCard
          testId="thread-draft-success"
          kind="스레드 초안"
          title={`“${r.draft.thread.name}”`}
          status="초안이 만들어졌어"
          primary={{ label: "스레드 열기", href: `/threads/${r.draft.thread.id}`, testId: "draft-open-link" }}
          secondary={
            <>
              <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 6px" }}>
                <span className="card-chip">이벤트 {r.draft.events.length}</span>
                <span className="card-chip">작업 {r.draft.tasks.length}</span>
                <span className="card-chip">연결 {r.draft.nodeLinks.length}</span>
              </p>
              {r.draft.warnings.length > 0 && (
                <ul className="thread-draft-warnings" role="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {r.draft.warnings.map((w, i) => (
                    <li key={i} className="card-meta" data-testid="draft-warning" style={{ color: "var(--moved)" }}>확인 필요: {w.message}</li>
                  ))}
                </ul>
              )}
            </>
          }
        />
      );
    }
    if (r.kind === "task") {
      return (
        <ResultCard
          kind="할 일"
          status="저장됐어"
          primary={{ label: "Today에서 보기", href: "/today" }}
          secondary="오늘 화면에서 할 일을 확인할 수 있어."
          testId="task-result"
        />
      );
    }
    if (r.kind === "watcher") {
      return (
        <ResultCard
          kind="Watcher"
          title={r.label}
          status="지켜볼 것이 만들어졌어"
          primary={{ label: "지켜볼 것에서 보기", href: "/watch" }}
          secondary="여백(/watch)에서 방금 만든 Watcher를 확인할 수 있어."
          testId="watcher-result"
        />
      );
    }
    return (
      <ResultCard
        kind="기록"
        title={r.eventTitle}
        status={r.parseStatus === "parsed" ? "기록됐어" : "원문 저장됨 (분석 대기)"}
        primary={{ label: "Today에서 보기", href: "/today" }}
        secondary="이벤트에 연결된 기록이야 — 이벤트 상세와 거울에서 볼 수 있어."
        testId="record-result"
      />
    );
  })();

  // Detail slot per Composer mode (cycle-71): watcher subtype fields / record target.
  const composerDetail =
    composer.mode === "watcher" ? (
      <WatcherFieldsPanel
        subtype={watcherSubtype}
        fields={watcherFields}
        onSubtypeChange={setWatcherSubtype}
        onFieldsChange={(patch) => setWatcherFields((f) => ({ ...f, ...patch }))}
      />
    ) : composer.mode === "record" ? (
      <RecordTargetSelect targets={recordTargets} selectedId={recordTargetId} onSelect={setRecordTargetId} />
    ) : undefined;

  const composerSubmitDisabled =
    composer.mode === "watcher" ? !watcherSubtypeValid(watcherSubtype, watcherFields)
    : composer.mode === "record" ? recordTargetId == null || !recordTargets.some((t) => t.id === recordTargetId)
    : false;

  const composerSection = (
    <>
      <CreationComposer
        title="새로 만들기"
        modes={COMPOSER_MODES}
        mode={composer.mode}
        text={composer.text}
        submitting={composer.submitting}
        detail={composerDetail}
        submitDisabled={composerSubmitDisabled}
        onModeChange={(m) => setComposer((c) => (c.mode === m ? c : { ...c, mode: m, error: null, result: null }))}
        onTextChange={(text) => setComposer((c) => ({ ...c, text }))}
        onSubmit={() => void handleComposerSubmit()}
      />
      {composerResultCard}
      {composer.error && (
        <p className="input-error" role="alert">{composer.error}</p>
      )}
    </>
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
          <fieldset className="input-mode-chips" aria-label="진행 방식 (선택)">
            <legend className="input-mode-legend">진행 방식 (선택)</legend>
            {EVENT_MODE_CHIPS.map((chip) => {
              const active = form.eventForm.eventMode === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  className={`input-mode-chip${active ? " input-mode-chip--active" : ""}`}
                  aria-pressed={active}
                  disabled={form.submitting}
                  onClick={() => setForm((f) => ({
                    ...f,
                    eventForm: { ...f.eventForm, eventMode: active ? null : chip.value }
                  }))}
                >
                  {chip.label}
                </button>
              );
            })}
          </fieldset>
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
      {form.saved && (
        <ResultCard
          kind={form.mode === "event" ? "일정" : "할 일"}
          status="저장됐어"
          primary={{ label: "Today에서 보기", href: "/today" }}
          secondary={form.mode === "event" ? "오늘 화면에서 확인할 수 있어." : "오늘 화면에서 할 일을 확인할 수 있어."}
          testId="manual-result"
        />
      )}
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

  // Advanced manual event/task forms (cycle-69): collapsed by default behind a
  // visible, reversible 고급 입력 toggle; the detailed start/end/person/mode and
  // estimate/thread fields stay reachable here in quiet and live states.
  const advancedSection = (
    <section className="input-section input-advanced">
      <button
        type="button"
        className="input-advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((o) => !o)}
      >
        고급 입력 {advancedOpen ? "▲" : "▼"}
      </button>
      {advancedOpen && formSection}
    </section>
  );

  if (view.tag === "quiet") {
    return (
      <>
        <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-quiet">
          {composerSection}
          {advancedSection}
        </main>
        {constraintSheetOverlay}
      </>
    );
  }

  return (
    <>
      <main className="app-shell input-hub" aria-label="입력 허브" data-testid="input-live">
        {composerSection}
        {advancedSection}
        {renderUnscheduledSection(view.unscheduled)}
      </main>
      {constraintSheetOverlay}
    </>
  );
}
