import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalendarData, EventCandidate, EventRow, TaskRow } from "@cairn/shared";
import { apiJson, DATA_CHANGED_EVENT, openAccessLogin } from "./api.js";
import { AttachedNotes, NOTES_CHANGED_EVENT, NoteFlow, formatDay, localDateOf, shiftDate, todayLocal } from "./Notes.js";
import { CandidateList, useCandidates } from "./Candidates.js";
import { Today } from "./Today.js";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const GRID_DAYS = 42;
const OUTCOME_WINDOW_MS = 14 * 86_400_000;

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

// Six full weeks starting on the Sunday on or before the 1st.
function gridDays(month: string): string[] {
  const first = `${month}-01`;
  const start = shiftDate(first, -weekdayOf(first));
  return Array.from({ length: GRID_DAYS }, (_, i) => shiftDate(start, i));
}

function isAllDay(event: EventRow): boolean {
  return event.type === "all_day";
}

// Local days an event touches. The end is exclusive, so an all-day event ending at the
// next midnight stays on its own day.
function eventDays(event: EventRow): string[] {
  const first = localDateOf(event.start);
  if (!first) return [];
  const endMs = event.end ? Date.parse(event.end) - 1 : NaN;
  const last = Number.isNaN(endMs) ? first : todayLocal(new Date(Math.max(endMs, Date.parse(event.start!))));
  const days: string[] = [];
  for (let day = first; day <= last && days.length < GRID_DAYS; day = shiftDate(day, 1)) days.push(day);
  return days;
}

const timeFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

function clock(value: string | null): string {
  if (!value) return "";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? "" : timeFormat.format(new Date(ms));
}

function eventTime(event: EventRow, day: string): string {
  if (isAllDay(event)) return "종일";
  const startsToday = localDateOf(event.start) === day;
  const endsToday = event.end ? todayLocal(new Date(Date.parse(event.end) - 1)) === day : true;
  if (startsToday && endsToday) return `${clock(event.start)} – ${clock(event.end)}`;
  if (startsToday) return `${clock(event.start)} –`;
  if (endsToday) return `– ${clock(event.end)}`;
  return "하루 종일 이어짐";
}

// pending: events of the day that are over but have no recorded outcome yet.
type DayBucket = { events: EventRow[]; tasks: TaskRow[]; notes: number; pending: EventRow[] };

function bucketDays(data: CalendarData | null, nowMs: number): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  if (!data) return map;
  const recorded = new Set(data.outcomeRecordedEventIds ?? []);
  const at = (day: string): DayBucket => {
    let bucket = map.get(day);
    if (!bucket) {
      bucket = { events: [], tasks: [], notes: 0, pending: [] };
      map.set(day, bucket);
    }
    return bucket;
  };
  for (const event of data.events ?? []) {
    const days = eventDays(event);
    for (const day of days) at(day).events.push(event);
    // Ask for the outcome once, on the day the event ended — and only for recent, timed events.
    // Birthdays and other all-day markers have no outcome, and old history is not a to-do list.
    const endMs = event.end != null ? Date.parse(event.end) : NaN;
    const over = endMs <= nowMs && endMs >= nowMs - OUTCOME_WINDOW_MS;
    const open = event.status === "planned" || event.status === "confirmed";
    const lastDay = days[days.length - 1];
    if (over && open && !isAllDay(event) && !recorded.has(event.id) && lastDay) at(lastDay).pending.push(event);
  }
  for (const task of data.tasks ?? []) {
    const day = localDateOf(task.due);
    if (day) at(day).tasks.push(task);
  }
  for (const [day, count] of Object.entries(data.noteCounts ?? {})) at(day).notes = count;
  for (const bucket of map.values()) {
    bucket.events.sort((a, b) => Number(isAllDay(b)) - Number(isAllDay(a)) || Date.parse(a.start!) - Date.parse(b.start!));
  }
  return map;
}

const EMPTY_BUCKET: DayBucket = { events: [], tasks: [], notes: 0, pending: [] };

const STATUS_LABEL: Record<string, string> = { planned: "예정", confirmed: "확정", done: "완료", moved: "이동", late: "늦음", cancelled: "취소" };

// ── Day panel ───────────────────────────────────────────────────────────────

type PanelTab = "schedule" | "actions" | "notes" | "space";

const OUTCOMES = [
  { id: "done", label: "완료" },
  { id: "moved", label: "이동" },
  { id: "cancelled", label: "취소" },
  { id: "late", label: "지연" }
] as const;

// Events that are over and still unanswered: one tap records what happened.
function DayOutcomes({ day, events, onRecorded }: { day: string; events: EventRow[]; onRecorded: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const record = async (eventId: number, outcome: (typeof OUTCOMES)[number]["id"]) => {
    setBusy(eventId);
    setError(null);
    try {
      const res = await apiJson<ApiResponse<unknown>>(`/api/events/${eventId}/outcome`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome })
      });
      if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || "결과를 저장하지 못했습니다");
      onRecorded();
    } catch (e) {
      setError(e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "결과를 저장하지 못했습니다");
    } finally {
      setBusy(null);
    }
  };

  if (events.length === 0) return null;
  return (
    <section className="day-outcomes" aria-label="결과 기록">
      <p className="event-detail-section-label">어떻게 됐나요?</p>
      <ul className="day-event-list" role="list">
        {events.map((event) => (
          <li key={event.id} className="day-outcome">
            <p className="day-event-time">{eventTime(event, day)}</p>
            <p className="day-event-title">{event.title}</p>
            <div className="day-outcome-actions" role="group" aria-label={`${event.title} 결과`}>
              {OUTCOMES.map((o) => (
                <button key={o.id} type="button" className="day-outcome-btn" disabled={busy === event.id} onClick={() => void record(event.id, o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </section>
  );
}

function DaySchedule({ day, bucket, onOpenEvent }: { day: string; bucket: DayBucket; onOpenEvent: (id: number) => void }) {
  if (bucket.events.length === 0 && bucket.tasks.length === 0) {
    return null;
  }

  return (
    <div className="day-schedule">
      {bucket.events.length > 0 && (
        <ul className="day-event-list" role="list" aria-label="일정">
          {bucket.events.map((event) => (
            <li key={event.id} className="day-event" data-status={event.status ?? undefined}>
              <button type="button" className="day-event-row" onClick={() => onOpenEvent(event.id)} aria-label={`${eventTime(event, day)} ${event.title} 상세 보기`}>
                <span className="day-event-time">
                  {[eventTime(event, day), event.status && event.status !== "planned" ? STATUS_LABEL[event.status] ?? event.status : null, event.location].filter(Boolean).join(" · ")}
                </span>
                <span className="day-event-title">{event.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {bucket.tasks.length > 0 && (
        <section aria-label="마감인 할 일">
          <p className="event-detail-section-label">이 날 마감</p>
          <ul className="day-task-list" role="list">
            {bucket.tasks.map((task) => (
              <li key={task.id} className="day-task">
                <span className="day-task-title">{task.title}</span>
                {task.estMinutes != null && <span className="day-event-time">{task.estMinutes}분</span>}
                {task.threadId != null && <a className="note-meta-link" href={`/threads/${task.threadId}`}>스레드</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type DayPanelProps = { day: string; today: string; bucket: DayBucket; candidates: EventCandidate[]; open: boolean; onClose: () => void; onReload: () => void };

function DayPanel({ day, today, bucket, candidates, open, onClose, onReload }: DayPanelProps) {
  const [tab, setTab] = useState<PanelTab>("schedule");
  const [writing, setWriting] = useState(false);
  const [cardCount, setCardCount] = useState(0);
  const [addSeq, setAddSeq] = useState(0);
  const [openEvent, setOpenEvent] = useState<{ id: number; seq: number } | null>(null);
  const scheduleCount = bucket.events.length + bucket.tasks.length;
  const actionCount = bucket.pending.length + cardCount + candidates.length;
  // Tabs follow the order of work: see the day → deal with what needs a decision → notes → headroom.
  const tabs: Array<{ id: PanelTab; label: string; count: number }> = [
    { id: "schedule", label: "일정", count: scheduleCount },
    { id: "actions", label: "처리", count: actionCount },
    { id: "notes", label: "메모", count: bucket.notes },
    { id: "space", label: "여유", count: 0 }
  ];

  return (
    <>
      <aside className="day-panel" data-open={open ? "true" : "false"} aria-label={`${formatDay(day)} 상세`}>
        <header className="day-panel-head">
          <div>
            <h2 className="day-panel-title">{formatDay(day)}</h2>
            {day === today && <span className="note-badge">오늘</span>}
          </div>
          <button type="button" className="note-flow-close day-panel-close" onClick={onClose} aria-label="날짜 상세 닫기">✕</button>
        </header>
        <div className="day-panel-tabs" role="tablist" aria-label="날짜 상세 단계">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`day-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`day-tabpanel-${t.id}`}
              className="day-panel-tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}{t.count > 0 && <span className="day-panel-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="day-panel-body" role="tabpanel" id={`day-tabpanel-${tab}`} aria-labelledby={`day-tab-${tab}`}>
          {tab === "schedule" && (
            <>
              <DaySchedule key={day} day={day} bucket={bucket} onOpenEvent={(id) => setOpenEvent((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))} />
              <button type="button" className="note-btn day-panel-action" onClick={() => setAddSeq((n) => n + 1)}>+ 일정·할 일</button>
            </>
          )}
          {tab === "actions" && (
            <>
              <CandidateList candidates={candidates} label="이 날 일정 후보" />
              <DayOutcomes day={day} events={bucket.pending} onRecorded={onReload} />
            </>
          )}
          {tab === "notes" && (
            <>
              <button type="button" className="note-btn note-btn--primary day-panel-action" onClick={() => setWriting(true)}>+ 메모</button>
              <AttachedNotes key={day} title="이 날 메모" date={day} canAdd={false} />
            </>
          )}
          {/* One Today instance per day: it owns the day's cards, energy panel and their sheets.
              The tab decides which of its sections shows; it stays mounted so the 처리 count is known. */}
          {open && <Today
            date={day}
            embed={tab === "actions" ? "cards" : tab === "space" ? "feasibility" : "none"}
            onCount={setCardCount}
            onChanged={onReload}
            addRequest={addSeq}
            openEvent={openEvent}
          />}
        </div>
      </aside>
      {writing && <NoteFlow defaultDate={day} onClose={() => setWriting(false)} />}
    </>
  );
}

// ── Calendar page ───────────────────────────────────────────────────────────

type LoadState =
  | { tag: "loading" }
  | { tag: "ready" }
  | { tag: "error"; message: string; needsLogin: boolean };

function initialDay(): string | null {
  const date = new URLSearchParams(window.location.search).get("date");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function CalendarPage() {
  const today = todayLocal();
  const linked = useMemo(initialDay, []);
  const [month, setMonth] = useState(() => monthOf(linked ?? today));
  const [selected, setSelected] = useState(linked ?? today);
  // The calendar is the home screen, so it opens on today's panel: what is on, what needs a
  // decision. The panel is a toggle — tapping the selected date again (or ✕) puts it away and
  // the calendar takes the whole screen.
  const [panelOpen, setPanelOpen] = useState(true);
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<LoadState>({ tag: "loading" });
  const days = useMemo(() => gridDays(month), [month]);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await apiJson<ApiResponse<CalendarData>>(`/api/calendar?from=${from}&to=${to}`);
      if (mine !== seq.current) return;
      if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || "달력을 불러오지 못했습니다");
      setData(res.data);
      setState({ tag: "ready" });
    } catch (e) {
      if (mine !== seq.current) return;
      const needsLogin = Boolean(e && typeof e === "object" && "kind" in e && e.kind === "access_session_required");
      const message = e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "달력을 불러오지 못했습니다";
      setState({ tag: "error", message, needsLogin });
    }
  }, [from, to]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(NOTES_CHANGED_EVENT, onChange);
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(NOTES_CHANGED_EVENT, onChange);
      window.removeEventListener(DATA_CHANGED_EVENT, onChange);
    };
  }, [load]);

  const buckets = useMemo(() => bucketDays(data, Date.now()), [data]);
  const { candidates } = useCandidates();
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const dayCandidates = useMemo(() => candidates.filter((c) => localDateOf(c.start) === selected), [candidates, selected]);
  const candidateDays = useMemo(() => new Set(candidates.map((c) => localDateOf(c.start))), [candidates]);

  const pick = (day: string) => {
    if (day === selected && panelOpen) {
      setPanelOpen(false);
      return;
    }
    setSelected(day);
    setPanelOpen(true);
    if (monthOf(day) !== month) setMonth(monthOf(day));
  };

  const goToday = () => {
    setMonth(monthOf(today));
    setSelected(today);
  };

  return (
    <main className="calendar-page" data-panel={panelOpen ? "open" : "closed"} aria-labelledby="calendar-title">
      <section className="calendar-main">
        <header className="calendar-head">
          <h1 id="calendar-title">{monthLabel(month)}</h1>
          <div className="calendar-nav">
            <button type="button" className="calendar-nav-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">‹</button>
            <button type="button" className="calendar-nav-btn calendar-nav-today" onClick={goToday}>오늘</button>
            <button type="button" className="calendar-nav-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">›</button>
          </div>
        </header>

        {candidates.length > 0 && (
          <button type="button" className="calendar-candidates-btn" onClick={() => setCandidatesOpen(true)} aria-haspopup="dialog" aria-label={`일정 후보 ${candidates.length}건 보기`}>
            <span>일정 후보 <span className="day-panel-tab-count">{candidates.length}</span></span>
            <span className="calendar-candidates-go" aria-hidden="true">보기 ›</span>
          </button>
        )}

        {state.tag === "error" && (
          <div className="calendar-error" role="alert">
            <p>달력을 불러오지 못했습니다. {state.message}</p>
            {state.needsLogin && <button type="button" className="note-btn note-btn--primary" onClick={openAccessLogin}>다시 로그인</button>}
            <button type="button" className="note-btn" onClick={() => { setState({ tag: "loading" }); void load(); }}>다시 시도</button>
          </div>
        )}

        <div className="calendar-grid" role="grid" aria-label={monthLabel(month)} aria-busy={state.tag === "loading"}>
          <div className="calendar-weekdays" role="row">
            {WEEKDAYS.map((name, i) => (
              <span key={name} role="columnheader" className="calendar-weekday" data-weekend={i === 0 || i === 6 ? "true" : undefined}>{name}</span>
            ))}
          </div>
          {Array.from({ length: GRID_DAYS / 7 }, (_, week) => (
            <div key={week} className="calendar-week" role="row">
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                const bucket = buckets.get(day) ?? EMPTY_BUCKET;
                const count = bucket.events.length + bucket.tasks.length;
                const dayNumber = Number(day.slice(8));
                const summary = [
                  formatDay(day),
                  day === today ? "오늘" : null,
                  count > 0 ? `일정 ${count}건` : null,
                  bucket.pending.length > 0 ? `결과 기록 ${bucket.pending.length}건` : null,
                  candidateDays.has(day) ? "일정 후보 있음" : null,
                  bucket.notes > 0 ? `메모 ${bucket.notes}건` : null
                ].filter(Boolean).join(", ");
                return (
                  <div key={day} role="gridcell" className="calendar-cell-wrap">
                    <button
                      type="button"
                      className="calendar-cell"
                      data-outside={monthOf(day) !== month ? "true" : undefined}
                      data-weekend={weekdayOf(day) === 0 || weekdayOf(day) === 6 ? "true" : undefined}
                      aria-current={day === today ? "date" : undefined}
                      aria-pressed={day === selected}
                      aria-expanded={day === selected ? panelOpen : undefined}
                      aria-label={summary}
                      data-candidate={candidateDays.has(day) ? "true" : undefined}
                      onClick={() => pick(day)}
                    >
                      <span className="calendar-cell-day">{dayNumber}</span>
                      {state.tag === "loading" && !data ? (
                        <span className="calendar-cell-skel" aria-hidden="true" />
                      ) : (
                        <>
                          <span className="calendar-cell-titles" aria-hidden="true">
                            {bucket.events.slice(0, 2).map((event) => (
                              <span key={event.id} className="calendar-cell-title" data-allday={isAllDay(event) ? "true" : undefined}>{event.title}</span>
                            ))}
                            {count > 2 && <span className="calendar-cell-more">+{count - Math.min(2, bucket.events.length)}</span>}
                          </span>
                          <span className="calendar-cell-dots" aria-hidden="true">
                            {Array.from({ length: Math.min(count, 3) }, (_, i) => <span key={i} className="calendar-dot" />)}
                            {bucket.pending.length > 0 && <span className="calendar-dot calendar-dot--pending" />}
                            {bucket.notes > 0 && <span className="calendar-dot calendar-dot--note" />}
                          </span>
                          {bucket.pending.length > 0 && <span className="calendar-cell-note calendar-cell-pending" aria-hidden="true">기록 {bucket.pending.length}</span>}
                          {bucket.notes > 0 && <span className="calendar-cell-note" aria-hidden="true">메모 {bucket.notes}</span>}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="calendar-legend" aria-hidden="true">
          <span className="calendar-dot" /> 일정·마감 <span className="calendar-dot calendar-dot--pending" /> 결과 기록 <span className="calendar-dot calendar-dot--note" /> 메모
        </p>
      </section>

      <DayPanel key={selected} day={selected} today={today} bucket={buckets.get(selected) ?? EMPTY_BUCKET} candidates={dayCandidates} open={panelOpen} onClose={() => setPanelOpen(false)} onReload={() => void load()} />
      {candidatesOpen && candidates.length > 0 && createPortal(
        <>
          <div className="sheet-backdrop" onClick={() => setCandidatesOpen(false)} aria-hidden="true" />
          <div className="sheet sheet--entering candidate-sheet" role="dialog" aria-modal="true" aria-label="일정 후보">
            <header className="candidate-sheet-head">
              <h2 className="candidate-sheet-title">일정 후보</h2>
              <button type="button" className="note-flow-close" onClick={() => setCandidatesOpen(false)} aria-label="닫기">✕</button>
            </header>
            <CandidateList candidates={candidates} />
          </div>
        </>,
        document.body
      )}
    </main>
  );
}
