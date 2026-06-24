import { useCallback, useEffect, useRef, useState } from "react";
import type { ConflictDecision, DayFeasibility, EventDetailData, EventRow, FeasibilityParamLimits, FeasibilityParamSettingsData, FeasibilityParams, NotificationDraft, SlotCandidate, SlotSuggestionContribution, ThreadSummary, TodaySurface, UpdateFeasibilityParamsRequest } from "@cairn/shared";
import { ResolveConflictResponseDataSchema } from "@cairn/shared";
import { datetimeLocalToRfc3339, localDateString } from "./dateUtils.js";
import { apiJson, type AccessSessionError } from "./api.js";

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

type ConflictSheetState =
  | { open: false }
  | { open: true; resolved: false; conflict: ConflictDecision; submitting: boolean; error: string | null }
  | { open: true; resolved: true; outcome: "moved" | "cancelled"; changedEvent: EventRow; notificationDrafts: NotificationDraft[] };

type SheetMode = "task" | "event";
type TaskForm = { title: string; estMinutes: string; threadId: string };
type EventForm = { title: string; start: string; end: string; threadId: string };
type SheetState =
  | { open: false }
  | { open: true; mode: SheetMode; taskForm: TaskForm; eventForm: EventForm; submitting: boolean; error: string | null };

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet"; surface: TodaySurface }
  | { tag: "live"; surface: TodaySurface }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

type FeasSettingsSheetState =
  | { open: false }
  | {
      open: true;
      loadState: "loading" | "ready" | "error";
      draft: UpdateFeasibilityParamsRequest;
      limits: FeasibilityParamLimits;
      defaults: FeasibilityParams;
      preview: DayFeasibility | null;
      previewError: string | null;
      saveError: string | null;
      saving: boolean;
    };

const EMPTY_TASK_FORM: TaskForm = { title: "", estMinutes: "2", threadId: "" };
const EMPTY_EVENT_FORM: EventForm = { title: "", start: "", end: "", threadId: "" };


async function loadSurface(): Promise<TodaySurface> {
  const date = localDateString();
  const now = new Date().toISOString();
  const body = await apiJson<{ ok: boolean; data?: TodaySurface; error?: { message: string } }>(
    `/api/today?date=${date}&now=${encodeURIComponent(now)}`
  );
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

async function markTaskDone(id: number): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/tasks/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  if (!body.ok) throw new Error("완료 처리 실패");
}

async function submitAnnotation(eventId: number, text: string): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/events/${eventId}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!body.ok) throw new Error("제출 실패");
}

async function loadThreadOptions(): Promise<ThreadSummary[]> {
  try {
    const body = await apiJson<{ ok: boolean; data?: ThreadSummary[] }>("/api/threads");
    return body.ok ? (body.data ?? []) : [];
  } catch {
    // Non-critical — missing thread dropdown is acceptable degradation
    return [];
  }
}

async function createTask(title: string, estMinutes: number, threadId?: number): Promise<void> {
  const payload: Record<string, unknown> = { title, estMinutes };
  if (threadId != null) payload.threadId = threadId;
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!body.ok) throw new Error("작업 생성 실패");
}

type QuickCaptureResult = { captureStatus: "scheduled" | "unscheduled" | "raw_stored" };

async function flatCapture(text: string): Promise<QuickCaptureResult> {
  const now = new Date().toISOString().replace("Z", "+00:00");
  const body = await apiJson<{ ok: boolean; data?: QuickCaptureResult; error?: { message: string } }>("/api/capture/flat-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, now })
  });
  if (!body.ok) throw new Error(body.error?.message ?? "캡처 실패");
  return body.data!;
}

async function fetchEventDetail(id: number): Promise<EventDetailData> {
  const body = await apiJson<{ ok: boolean; data?: EventDetailData; error?: { message: string } }>(`/api/events/${id}`);
  if (!body.ok) throw new Error(body.error?.message ?? "불러오기 실패");
  return body.data!;
}

async function snoozeWatcher(id: number, snoozedUntil: string): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/watchers/${id}/snooze`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snoozedUntil })
  });
  if (!body.ok) throw new Error(body.error?.message ?? "스누즈 실패");
}

async function patchStatus(id: number, status: string): Promise<void> {
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!body.ok) throw new Error("상태 변경 실패");
}

async function createEvent(title: string, start: string, end: string, threadId?: number): Promise<void> {
  const payload: Record<string, unknown> = { title, start, end };
  if (threadId != null) payload.threadId = threadId;
  const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!body.ok) throw new Error("일정 생성 실패");
}

const TRANSITION_COST_LABEL: Record<DayFeasibility["transitionCosts"][number]["costLevel"], string> = {
  none: "없음",
  low: "낮음",
  high: "높음",
  unknown: "불확실"
};

const TRANSITION_RELATION_TEXT: Record<DayFeasibility["transitionCosts"][number]["relation"], string> = {
  same_thread: "같은 스레드",
  context_link: "맥락이 이어져 있어",
  non_context_link: "관계는 있지만 맥락은 달라",
  unrelated: "이어지는 맥락이 없어",
  missing_thread: "스레드 정보가 없어"
};

function TransitionCostsSection({
  transitions,
  events
}: {
  transitions: DayFeasibility["transitionCosts"];
  events: EventRow[];
}) {
  // Descriptive only: hide `none` (same-thread) rows; show low/high/unknown.
  const shown = (transitions ?? []).filter((t) => t.costLevel !== "none");
  if (shown.length === 0) return null;
  const titleOf = (id: number) => events.find((e) => e.id === id)?.title ?? "이벤트";

  return (
    <div className="feas-transitions" aria-label="맥락 전환">
      <p className="feas-transitions-head">맥락 전환</p>
      <ul className="feas-transition-list" role="list">
        {shown.map((t, i) => (
          <li
            key={`${t.fromEventId}-${t.toEventId}-${i}`}
            className={`feas-transition feas-transition--${t.costLevel}`}
            data-testid="transition-row"
            data-cost={t.costLevel}
          >
            <span className="feas-transition-pair">
              {titleOf(t.fromEventId)} → {titleOf(t.toEventId)}
            </span>
            <span className="feas-transition-cost">전환 비용 {TRANSITION_COST_LABEL[t.costLevel]}</span>
            <span className="feas-transition-reason card-meta">{TRANSITION_RELATION_TEXT[t.relation]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SequenceEnergySection({ seq }: { seq: DayFeasibility["sequenceEnergy"] }) {
  if (!seq) return null;
  // Only surface when transition load changes the picture, or unknowns exist.
  // A same-thread-only day (no added load, no unknowns) shows nothing.
  const hasAddedLoad = seq.totalLoadUnits !== seq.workLoadUnits;
  const hasUnknown = seq.unknownTransitionCount > 0;
  if (!hasAddedLoad && !hasUnknown) return null;

  return (
    <div className="feas-sequence" aria-label="전환 포함" data-testid="sequence-energy" data-deficit={seq.deficit ? "true" : "false"}>
      <p className="feas-sequence-head">전환 포함</p>
      <p className="feas-sequence-line">
        <span className="feas-sequence-work">일 {seq.workLoadUnits.toFixed(2)}h</span>
        {hasAddedLoad && (
          <span className="feas-sequence-added"> + 전환 {seq.transitionLoadUnits.toFixed(2)}h</span>
        )}
        <span className="feas-sequence-total"> = 합계 {seq.totalLoadUnits.toFixed(2)}h / {seq.budgetUnits}h</span>
        {seq.deficit && <span className="feas-deficit" role="status"> 초과</span>}
      </p>
      {hasUnknown && (
        <p className="feas-sequence-unknown card-meta">
          전환 {seq.unknownTransitionCount}건은 스레드 정보가 없어 비용을 매기지 않았어
        </p>
      )}
      <p className="feas-confidence">추정치 (cold start)</p>
    </div>
  );
}

function FeasibilityPanel({ f, events = [], onAdjust }: { f: DayFeasibility; events?: EventRow[]; onAdjust?: () => void }) {
  const { energy, gaps, continuous, transitionCosts, sequenceEnergy } = f;
  const pct = Math.min(100, Math.round((energy.loadUnits / energy.budgetUnits) * 100));
  const warningGaps = gaps.filter((g) => g.status !== "ok");
  return (
    <div className="feas-panel" aria-label="일정 부하">
      <div className="feas-energy">
        <span className="feas-energy-label">에너지</span>
        <div className="feas-gauge" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`에너지 부하 ${pct}%`}>
          <div className={`feas-gauge-fill${energy.deficit ? " feas-gauge-fill--deficit" : ""}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="feas-energy-val">{energy.loadUnits.toFixed(1)}h / {energy.budgetUnits}h</span>
        {energy.deficit && <span className="feas-deficit" role="status">초과</span>}
      </div>
      <p className="feas-confidence">추정치 (cold start)</p>
      {warningGaps.map((g, i) => (
        <div key={i} className={`feas-gap feas-gap--${g.status}`} role="status">
          {g.status === "impossible" ? "⚠ 겹침" : "⚠ 여유 부족"}{" "}
          {g.availableMinutes < 0
            ? `${Math.round(-g.availableMinutes)}분 초과`
            : `${Math.round(g.availableMinutes)}분`}
          {g.mode === "near" && " · 임박"}
        </div>
      ))}
      {continuous?.exceedsMax && (
        <div className="feas-continuous" role="status">
          ⚠ 연속 {Math.round(continuous.spanMinutes)}분 — 쉬는 시간 없어
        </div>
      )}
      <TransitionCostsSection transitions={transitionCosts} events={events} />
      <SequenceEnergySection seq={sequenceEnergy} />
      {onAdjust && (
        <button className="feas-adjust-btn" onClick={onAdjust} aria-label="feasibility 파라미터 조정">
          조정
        </button>
      )}
    </div>
  );
}

function ConflictDecisionSheet({
  conflict,
  submitting,
  error,
  onResolve,
  onClose
}: {
  conflict: ConflictDecision;
  submitting: boolean;
  error: string | null;
  onResolve: (keepId: number, changeId: number, outcome: "moved" | "cancelled") => void;
  onClose: () => void;
}) {
  const [optA, optB] = conflict.options;
  const fmtTime = (s: string | null) => s?.slice(11, 16) ?? "?";
  const fmtEffort: Record<string, string> = { none: "없음", low: "낮음", medium: "보통", high: "높음" };

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="충돌 해결">
      <div className="sheet-panel">
        <button className="sheet-close-btn" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="sheet-title">충돌 해결</h2>
        <p className="conflict-overlap">
          겹침 {Math.round(conflict.overlapMinutes)}분 · {conflict.urgency === "near" ? "임박" : "계획 중"}
        </p>
        {[optA, optB].map((opt) => {
          if (!opt) return null;
          const other = opt === optA ? optB : optA;
          if (!other) return null;
          const guardBlocked = opt.peopleGuard?.blocked ?? false;
          const isDisabled = submitting || conflict.actionability === "read_only" || guardBlocked;
          return (
            <div key={opt.event.id} className={`conflict-option${opt.suggested ? " conflict-option--suggested" : ""}${guardBlocked ? " conflict-option--blocked" : ""}`}>
              <div className="conflict-option-header">
                <span className="conflict-option-title">{opt.event.title}</span>
                <span className="conflict-option-time">
                  {fmtTime(opt.event.start)} – {fmtTime(opt.event.end)}
                </span>
                {opt.suggested && <span className="conflict-suggested-badge" role="note">추천</span>}
                {guardBlocked && <span className="conflict-blocked-badge" role="note">제약</span>}
              </div>
              <div className="conflict-costs" aria-label="취소 비용">
                {opt.cost.money != null && opt.cost.money > 0 && (
                  <span className="cost-chip cost-chip--money">💴 {opt.cost.money.toLocaleString()}원</span>
                )}
                {opt.cost.social != null && opt.cost.social > 0 && (
                  <span className="cost-chip cost-chip--social">👥 사회적 {opt.cost.social}</span>
                )}
                {opt.cost.effort && opt.cost.effort !== "none" && (
                  <span className="cost-chip cost-chip--effort">⚡ {fmtEffort[opt.cost.effort] ?? opt.cost.effort}</span>
                )}
                {opt.cost.money === 0 && opt.cost.social === 0 && (!opt.cost.effort || opt.cost.effort === "none") && (
                  <span className="cost-chip cost-chip--zero">비용 없음</span>
                )}
              </div>
              {(opt.socialContext?.contributions ?? []).length > 0 && (
                <ul className="conflict-social-contributions" aria-label="관계 기여">
                  {(opt.socialContext?.contributions ?? []).map((c) => (
                    <li key={c.personId} className="conflict-contribution">
                      {c.personName} — {c.totalMeets}회 ({c.frequencyBand})
                      {c.adjustment > 0 && <span className="conflict-contribution-adj"> +{c.adjustment}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {guardBlocked && (opt.peopleGuard?.constraints ?? []).length > 0 && (
                <ul className="conflict-guard-reasons" aria-label="제약 이유" role="note">
                  {(opt.peopleGuard?.constraints ?? []).map((g, i) => (
                    <li key={i} className="conflict-guard-reason">{g.personName}: {g.constraintText}</li>
                  ))}
                </ul>
              )}
              <div className="conflict-actions">
                <button
                  className="conflict-btn conflict-btn--move"
                  disabled={isDisabled}
                  onClick={() => onResolve(other.event.id, opt.event.id, "moved")}
                  aria-label={`${opt.event.title} 이동 처리`}
                >
                  이동
                </button>
                <button
                  className="conflict-btn conflict-btn--cancel"
                  disabled={isDisabled}
                  onClick={() => onResolve(other.event.id, opt.event.id, "cancelled")}
                  aria-label={`${opt.event.title} 취소 처리`}
                >
                  취소
                </button>
              </div>
            </div>
          );
        })}
        {conflict.actionability === "read_only" && (
          <p className="conflict-read-only-hint" role="note">아직 계획 구간이라 해소 버튼은 잠가둠</p>
        )}
        {optA?.peopleGuard?.blocked && optB?.peopleGuard?.blocked && (
          <p className="conflict-both-blocked" role="note">두 선택지 모두 사람 제약에 걸려있어. 직접 일정을 조율해줘.</p>
        )}
        {error && <p className="conflict-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

type DraftCopyState = Record<number, "idle" | "copied" | "error">;

function NotificationDraftCard({
  draft,
  copyState,
  onCopy
}: {
  draft: NotificationDraft;
  copyState: "idle" | "copied" | "error";
  onCopy: (personId: number, message: string) => void;
}) {
  const channelLabel = draft.channel && draft.channel !== "none" ? draft.channel : null;
  const leadLabel =
    draft.leadTimeStatus === "enough" ? `${draft.leadTimeDays}일 전 (충분)` :
    draft.leadTimeStatus === "late" ? `${draft.leadTimeDays != null ? draft.leadTimeDays + "일" : "?"}  (늦음)` :
    "리드타임 미설정";

  return (
    <div className="draft-card" data-testid={`draft-card-${draft.personId}`}>
      <div className="draft-card-header">
        <span className="draft-person-name">{draft.personName}</span>
        <span className="draft-channel">{channelLabel ?? "채널 미설정"}</span>
        <span className="draft-lead-time">{leadLabel}</span>
        <span className="draft-tone-label" aria-label="초안 톤">중립 초안</span>
      </div>
      <p className="draft-message" data-testid={`draft-message-${draft.personId}`}>{draft.message}</p>
      <div className="draft-actions">
        <button
          className="action-btn action-btn--sm"
          onClick={() => onCopy(draft.personId, draft.message)}
          aria-label={`${draft.personName} 초안 복사`}
        >
          복사
        </button>
        {copyState === "copied" && <span className="draft-copy-feedback draft-copy-feedback--ok" role="status">복사됨</span>}
        {copyState === "error" && <span className="draft-copy-feedback draft-copy-feedback--err" role="alert">복사 실패</span>}
      </div>
    </div>
  );
}

function ConflictResolvedSheet({
  outcome,
  changedEvent,
  notificationDrafts,
  onComplete,
  openerRef
}: {
  outcome: "moved" | "cancelled";
  changedEvent: EventRow;
  notificationDrafts: NotificationDraft[];
  onComplete: () => void;
  openerRef: React.RefObject<HTMLElement | null>;
}) {
  const [copyStates, setCopyStates] = useState<DraftCopyState>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    return () => { openerRef.current?.focus(); };
  }, [openerRef]);

  const handleCopy = useCallback((personId: number, message: string) => {
    const clip = navigator.clipboard;
    if (!clip) {
      setCopyStates((s) => ({ ...s, [personId]: "error" }));
      return;
    }
    Promise.resolve()
      .then(() => clip.writeText(message))
      .then(() => { setCopyStates((s) => ({ ...s, [personId]: "copied" })); })
      .catch(() => { setCopyStates((s) => ({ ...s, [personId]: "error" })); });
  }, []);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onComplete();
  }, [onComplete]);

  const focusableSel = 'button:not([disabled]),[tabindex="0"]:not([aria-hidden])';

  const handleStartSentinel = useCallback(() => {
    const panel = startSentinelRef.current?.parentElement;
    if (!panel) return;
    const all = Array.from(panel.querySelectorAll<HTMLElement>(focusableSel)).filter(
      (el) => el !== startSentinelRef.current && el !== endSentinelRef.current
    );
    all[all.length - 1]?.focus();
  }, []);

  const handleEndSentinel = useCallback(() => {
    const panel = endSentinelRef.current?.parentElement;
    if (!panel) return;
    const all = Array.from(panel.querySelectorAll<HTMLElement>(focusableSel)).filter(
      (el) => el !== startSentinelRef.current && el !== endSentinelRef.current
    );
    all[0]?.focus();
  }, []);

  const outcomeLabel = outcome === "moved" ? "이동" : "취소";

  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="충돌 해결 완료"
        className="bottom-sheet"
        onKeyDown={handleKey}
      >
        <div ref={startSentinelRef} tabIndex={0} aria-hidden="true" onFocus={handleStartSentinel} />
        <div className="sheet-header">
          <h2 className="sheet-title">{changedEvent.title ?? "일정"} — {outcomeLabel}</h2>
          <button ref={closeRef} className="sheet-close" onClick={onComplete} aria-label="닫기">✕</button>
        </div>
        <div className="sheet-body">
          <section aria-label="통보 초안">
            {notificationDrafts.length === 0 ? (
              <p className="draft-empty">연결된 사람이 없어 통보 초안이 없어.</p>
            ) : (
              notificationDrafts.map((draft) => (
                <NotificationDraftCard
                  key={draft.personId}
                  draft={draft}
                  copyState={copyStates[draft.personId] ?? "idle"}
                  onCopy={handleCopy}
                />
              ))
            )}
          </section>
          <div className="draft-complete-row">
            <button className="action-btn" onClick={onComplete}>완료</button>
          </div>
        </div>
        <div ref={endSentinelRef} tabIndex={0} aria-hidden="true" onFocus={handleEndSentinel} />
      </div>
    </>
  );
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
  const [conflictSheet, setConflictSheet] = useState<ConflictSheetState>({ open: false });
  const [watcherSnoozeError, setWatcherSnoozeError] = useState<Record<number, string>>({});
  const [feasSettings, setFeasSettings] = useState<FeasSettingsSheetState>({ open: false });
  const feasPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feasPreviewAbortRef = useRef<AbortController | null>(null);
  const savedMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const conflictOpenerRef = useRef<HTMLElement | null>(null);
  const conflictOpenerPairRef = useRef<string | null>(null);
  const liveMainRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setView({ tag: "loading" });
    try {
      const surface = await loadSurface();
      setView(
        surface.state === "quiet"
          ? { tag: "quiet", surface }
          : { tag: "live", surface }
      );
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setView({ tag: "access_error" });
      } else {
        setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
      }
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
        const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "오류";
        setSheet((prev) => prev.open ? { ...prev, submitting: false, error: msg } : prev);
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
        const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "오류";
        setSheet((prev) => prev.open ? { ...prev, submitting: false, error: msg } : prev);
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
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required"
        ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : null;
      setCapture((c) => ({ ...c, submitting: false, savedMsg: msg }));
      if (msg) savedMsgTimer.current = setTimeout(() => setCapture((c) => ({ ...c, savedMsg: null })), 6000);
    }
  }, [capture, refresh]);

  const handleLoadCandidates = useCallback(async (eventId: number) => {
    setSlotState((s) => ({ ...s, [eventId]: { tag: "loading" } }));
    try {
      const now = new Date().toISOString().replace("Z", "+00:00");
      const date = now.slice(0, 10);
      const body = await apiJson<{ ok: boolean; data?: { candidates: SlotCandidate[] }; error?: { message: string } }>(
        `/api/events/${eventId}/slot-candidates?date=${date}&now=${encodeURIComponent(now)}&days=7`
      );
      if (!body.ok) throw new Error(body.error?.message ?? "후보 로딩 실패");
      setSlotState((s) => ({ ...s, [eventId]: { tag: "loaded", candidates: body.data!.candidates } }));
    } catch (e) {
      setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
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
        setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: body.error?.message ?? "일정 저장 실패" } }));
        return;
      }
      setSlotState((s) => ({ ...s, [eventId]: { tag: "idle" } }));
      await refresh();
    } catch (e) {
      setSlotState((s) => ({ ...s, [eventId]: { tag: "error", message: e instanceof Error ? e.message : "오류" } }));
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
        const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "오류";
        setReplyState((prev) => ({
          ...prev,
          [eventId]: { text: rs.text, error: msg, submitting: false }
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
      } catch (e) {
        // Access errors are re-surfaced via refresh(); generic errors are silent
        if ((e as AccessSessionError).kind === "access_session_required") {
          await refresh();
        }
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
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        await refresh(); // triggers access_error view
      }
      // generic errors: sheet stays open
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
      await refresh();
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required" ? "로그인 세션이 만료됐거나 네트워크가 끊겼어" : e instanceof Error ? e.message : "오류";
      setDetailNote((n) => ({ ...n, submitting: false, error: msg }));
    }
  }, [selectedEventId, detailNote, refresh]);

  const handleOpenConflictSheet = useCallback(async (pairId: string, opener: HTMLElement | null) => {
    conflictOpenerRef.current = opener;
    conflictOpenerPairRef.current = pairId;
    const date = localDateString();
    const now = new Date().toISOString();
    try {
      const body = await apiJson<{ ok: boolean; data?: { conflicts: ConflictDecision[] } }>(
        `/api/decisions/conflicts?date=${date}&now=${encodeURIComponent(now)}`
      );
      if (!body.ok) return;
      const conflict = body.data?.conflicts.find((c) => c.id === pairId);
      if (!conflict) return;
      setConflictSheet({ open: true, resolved: false, conflict, submitting: false, error: null });
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        await refresh(); // triggers access_error view
      }
      // other errors: noop — don't open sheet on fetch failure
    }
  }, [refresh]);

  const handleCloseConflictSheet = useCallback(() => {
    setConflictSheet({ open: false });
  }, []);

  const handleCompleteResolved = useCallback(async () => {
    setConflictSheet({ open: false });
    await refresh();
    // refresh() remounts the card list, so the sheet's unmount-cleanup restore
    // targets a now-detached node. The normal resolve path removes the conflict,
    // so the live opener no longer exists; in that case focus the stable Today
    // region (liveMainRef, tabIndex=-1) instead of stranding focus on the
    // document body. If an opener survives the remount (conflict still present),
    // restore focus to it.
    const pairId = conflictOpenerPairRef.current;
    // Defer past React's commit of the refreshed surface so the live opener
    // (or the live main region) exists before we focus it.
    requestAnimationFrame(() => {
      const live = pairId
        ? document.querySelector<HTMLElement>(`[data-conflict-opener="${CSS.escape(pairId)}"]`)
        : null;
      (live ?? liveMainRef.current)?.focus();
    });
  }, [refresh]);

  const handleOpenFeasSettings = useCallback(async (currentParams: FeasibilityParams) => {
    const FALLBACK_LIMITS: FeasibilityParamLimits = {
      energyBudget:        { min: 1,    max: 16,  step: 0.5, unit: "h" },
      meetBufferMinutes:   { min: 0,    max: 120, step: 5,   unit: "min" },
      deepBufferMinutes:   { min: 0,    max: 180, step: 5,   unit: "min" },
      travelMargin:        { min: 0.5,  max: 3,   step: 0.1, unit: "x" },
      maxContinuousMinutes:{ min: 60,   max: 960, step: 30,  unit: "min" }
    };
    setFeasSettings({
      open: true,
      loadState: "loading",
      draft: currentParams,
      limits: FALLBACK_LIMITS,
      defaults: currentParams,
      preview: null,
      previewError: null,
      saveError: null,
      saving: false
    });
    try {
      const body = await apiJson<{ ok: boolean; data?: FeasibilityParamSettingsData; error?: { message: string } }>("/api/feasibility/params");
      if (!body.ok || !body.data) throw new Error(body.error?.message ?? "불러오기 실패");
      setFeasSettings((s) => s.open ? {
        ...s,
        loadState: "ready",
        draft: body.data!.params,
        limits: body.data!.limits,
        defaults: body.data!.defaults
      } : s);
    } catch {
      setFeasSettings((s) => s.open ? { ...s, loadState: "error" } : s);
    }
  }, []);

  const handleFeasSliderChange = useCallback((
    key: keyof UpdateFeasibilityParamsRequest,
    value: number,
    surface: TodaySurface
  ) => {
    setFeasSettings((s) => {
      if (!s.open) return s;
      return { ...s, draft: { ...s.draft, [key]: value }, previewError: null };
    });
    // Debounce preview request; cancel stale request.
    if (feasPreviewTimerRef.current) clearTimeout(feasPreviewTimerRef.current);
    if (feasPreviewAbortRef.current) feasPreviewAbortRef.current.abort();

    feasPreviewTimerRef.current = setTimeout(() => {
      setFeasSettings((s) => {
        if (!s.open) return s;
        const draft = { ...s.draft, [key]: value };
        const ctrl = new AbortController();
        feasPreviewAbortRef.current = ctrl;
        apiJson<{ ok: boolean; data?: DayFeasibility; error?: { message: string } }>(
          "/api/feasibility/day/preview",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: surface.date, now: surface.now, params: draft }),
            signal: ctrl.signal
          }
        ).then((body) => {
          if (!body.ok || !body.data) throw new Error(body.error?.message ?? "preview 실패");
          setFeasSettings((cur) => cur.open ? { ...cur, preview: body.data!, previewError: null } : cur);
        }).catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setFeasSettings((cur) => cur.open ? { ...cur, preview: null, previewError: (err instanceof Error ? err.message : "preview 실패") } : cur);
        });
        return { ...s, draft };
      });
    }, 300);
  }, []);

  const handleApplyFeasSettings = useCallback(async () => {
    if (!feasSettings.open) return;
    setFeasSettings((s) => s.open ? { ...s, saving: true, saveError: null } : s);
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/feasibility/params", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feasSettings.draft)
      });
      if (!body.ok) throw new Error(body.error?.message ?? "저장 실패");
      setFeasSettings({ open: false });
      await refresh();
    } catch (err: unknown) {
      setFeasSettings((s) => s.open ? { ...s, saving: false, saveError: (err instanceof Error ? err.message : "저장 실패") } : s);
    }
  }, [feasSettings, refresh]);

  const handleCloseFeasSettings = useCallback(() => {
    if (feasPreviewTimerRef.current) clearTimeout(feasPreviewTimerRef.current);
    if (feasPreviewAbortRef.current) feasPreviewAbortRef.current.abort();
    setFeasSettings({ open: false });
  }, []);

  const handleResolveConflict = useCallback(async (
    keepEventId: number,
    changeEventId: number,
    outcome: "moved" | "cancelled"
  ) => {
    if (!conflictSheet.open || conflictSheet.resolved) return;
    setConflictSheet((s) => s.open && !s.resolved ? { ...s, submitting: true, error: null } : s);
    try {
      const body = await apiJson<{ ok: boolean; data?: unknown; error?: { code: string } }>("/api/decisions/conflicts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepEventId, changeEventId, outcome })
      });
      if (!body.ok) {
        const msg =
          body.error?.code === "CONFLICT_STALE" ? "충돌이 이미 해소됐어" :
          body.error?.code === "CONFLICT_NOT_ACTIONABLE" ? "아직 해소할 수 있는 시간대가 아니야" :
          "처리 실패";
        setConflictSheet((s) => s.open && !s.resolved ? { ...s, submitting: false, error: msg } : s);
        return;
      }
      const parsed = ResolveConflictResponseDataSchema.safeParse(body.data);
      if (!parsed.success) {
        setConflictSheet((s) => s.open && !s.resolved ? { ...s, submitting: false, error: "서버 응답이 예상과 달라" } : s);
        return;
      }
      setConflictSheet({ open: true, resolved: true, outcome, changedEvent: parsed.data.changedEvent, notificationDrafts: parsed.data.notificationDrafts });
    } catch (e) {
      const msg = (e as AccessSessionError).kind === "access_session_required"
        ? "로그인 세션이 만료됐거나 네트워크가 끊겼어"
        : e instanceof Error ? e.message : "오류";
      setConflictSheet((s) => s.open && !s.resolved ? { ...s, submitting: false, error: msg } : s);
    }
  }, [conflictSheet, refresh]);

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

  if (view.tag === "access_error") {
    return (
      <main className="app-shell" aria-labelledby="today-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Today</p>
          <h1 id="today-title">로그인 세션이 필요해</h1>
          <p>Cloudflare Access 세션이 만료됐거나 아직 인증되지 않았어. 다시 로그인한 뒤 이 화면으로 돌아오면 돼.</p>
          <button
            className="today-access-login"
            onClick={() => { window.location.assign(window.location.href); }}
          >
            Access 로그인 다시 열기
          </button>
          <button className="today-retry" onClick={() => void refresh()}>
            다시 시도
          </button>
        </section>
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
          <FeasibilityPanel f={view.surface.feasibility} events={view.surface.dayEvents} />
        </main>
        {sheetEl}
        {eventDetailSheetEl}
      </>
    );
  }

  const { surface } = view;
  return (
    <>
      <main
        ref={liveMainRef}
        className="app-shell today-live"
        aria-labelledby="today-sr-title"
        tabIndex={-1}
        inert={conflictSheet.open && conflictSheet.resolved ? true : undefined}
      >
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
        <FeasibilityPanel
          f={surface.feasibility}
          events={surface.dayEvents}
          onAdjust={() => void handleOpenFeasSettings(surface.feasibility.params)}
        />
        <ul className="today-stack" role="list">
        {surface.cards.map((card, i) => {
          const delay = { animationDelay: `${i * 55}ms` } as React.CSSProperties;

          if (card.kind === "conflict") {
            const pairId = [card.pair.a.id, card.pair.b.id].sort((x, y) => x - y).join(":");
            return (
              <li key={`conflict-${i}`} className="today-card today-card--conflict" style={delay}>
                <span className="card-chip">충돌</span>
                <button
                  className="today-card-event-btn"
                  data-conflict-opener={pairId}
                  aria-label={`충돌 해결: ${card.pair.a.title} ↔ ${card.pair.b.title}`}
                  onClick={(e) => void handleOpenConflictSheet(pairId, e.currentTarget)}
                >
                  <p className="card-title">
                    {card.pair.a.title} ↔ {card.pair.b.title}
                  </p>
                  <p className="card-meta">
                    {card.pair.a.start?.slice(11, 16)} — {card.pair.b.end?.slice(11, 16)}
                  </p>
                </button>
              </li>
            );
          }

          if (card.kind === "watcher") {
            const w = card.watcher;
            const snoozeErr = watcherSnoozeError[w.id];
            const handleSnooze = async () => {
              const snoozedUntil = new Date(Date.parse(surface.now) + 86_400_000).toISOString();
              try {
                await snoozeWatcher(w.id, snoozedUntil);
                setWatcherSnoozeError((prev) => { const next = { ...prev }; delete next[w.id]; return next; });
                void refresh();
              } catch {
                setWatcherSnoozeError((prev) => ({ ...prev, [w.id]: "스누즈 실패. 다시 시도해봐." }));
              }
            };
            return (
              <li key={`watcher-${i}`} className="today-card today-card--watcher" style={delay}>
                <span className="card-chip">기한</span>
                {w.category && <span className="card-chip">{w.category}</span>}
                <p className="card-title">{w.label}</p>
                <p className="card-meta">
                  {w.threshold}
                  {w.daysOverdue > 0 && ` · ${w.daysOverdue}일 지남`}
                </p>
                <p className="card-meta" style={{ opacity: 0.8 }}>{w.message}</p>
                <button
                  className="today-action-btn"
                  onClick={() => void handleSnooze()}
                  aria-label={`${w.label ?? "watcher"} 내일 다시 보기`}
                  style={{ marginTop: "8px", minHeight: "44px" }}
                >
                  내일 다시 보기
                </button>
                {snoozeErr && (
                  <p className="card-meta" role="alert" style={{ color: "var(--conflict)", marginTop: "4px" }}>
                    {snoozeErr}
                  </p>
                )}
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
                <button
                  className="today-card-title-btn"
                  onClick={() => void handleOpenEventDetail(card.event.id)}
                  aria-label={`${card.event.title} 상세 보기`}
                >
                  <span className="card-title">{card.event.title} — 어떻게 됐어?</span>
                  <span className="card-meta">
                    {card.event.start?.slice(11, 16)} — {card.event.end?.slice(11, 16)}
                  </span>
                </button>
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
                <button
                  className="today-card-title-btn"
                  onClick={() => void handleOpenEventDetail(card.event.id)}
                  aria-label={`${card.event.title} 상세 보기`}
                >
                  <span className="card-title">날짜 잡을까? — {card.event.title}</span>
                </button>
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
                    {ss.candidates.map((c) => (
                      <li key={c.start} className="today-slot-item">
                        <button
                          className="today-slot-candidate"
                          onClick={() => void handleSchedule(card.event.id, c.start, c.end)}
                          aria-label={`${c.start.slice(0, 10)} ${c.start.slice(11, 16)} 선택`}
                        >
                          <span className="today-slot-time">
                            {c.start.slice(0, 10)} {c.start.slice(11, 16)} – {c.end.slice(11, 16)}
                          </span>
                          <span className="today-slot-score-label">{c.scoreLabel}</span>
                        </button>
                        <ul className="today-slot-reasons" role="list" aria-label="추천 이유">
                          {c.contributions.slice(0, 4).map((contrib: SlotSuggestionContribution) => (
                            <li key={contrib.lens} className={`today-slot-reason today-slot-reason--${contrib.impact}`}>
                              <span className="today-slot-reason-text">
                                {contrib.evidence[0] ?? contrib.label}
                              </span>
                              {contrib.lens === "feasibility" && contrib.impact !== "neutral" && (
                                <button
                                  className="today-slot-reason-link"
                                  onClick={() => void handleOpenFeasSettings(surface.feasibility.params)}
                                  aria-label="슬롯 체력 파라미터 조정"
                                >
                                  조정
                                </button>
                              )}
                              {contrib.lens === "friction" && contrib.impact !== "neutral" && (
                                <a className="today-slot-reason-link" href="/mirror" aria-label="Mirror에서 패턴 보기">
                                  패턴
                                </a>
                              )}
                              {contrib.lens === "people" && contrib.impact !== "neutral" &&
                               contrib.personIds !== undefined && contrib.personIds.length === 1 && (
                                <a
                                  className="today-slot-reason-link"
                                  href={`/people/${contrib.personIds[0]}`}
                                  aria-label="사람 상세 보기"
                                >
                                  프로필
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
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
      {conflictSheet.open && !conflictSheet.resolved && (
        <ConflictDecisionSheet
          conflict={conflictSheet.conflict}
          submitting={conflictSheet.submitting}
          error={conflictSheet.error}
          onResolve={handleResolveConflict}
          onClose={handleCloseConflictSheet}
        />
      )}
      {conflictSheet.open && conflictSheet.resolved && (
        <ConflictResolvedSheet
          outcome={conflictSheet.outcome}
          changedEvent={conflictSheet.changedEvent}
          notificationDrafts={conflictSheet.notificationDrafts}
          onComplete={() => void handleCompleteResolved()}
          openerRef={conflictOpenerRef}
        />
      )}
      {feasSettings.open && (
        <>
          <div
            className="sheet-backdrop"
            onClick={handleCloseFeasSettings}
            aria-hidden="true"
          />
          <div
            className="sheet sheet--entering"
            role="dialog"
            aria-modal="true"
            aria-label="feasibility 파라미터 조정"
          >
            <span className="sheet-handle" aria-hidden="true" />
            <div className="feas-settings-header">
              <h2 className="feas-settings-title">파라미터 조정</h2>
              <button
                className="sheet-close-btn"
                onClick={handleCloseFeasSettings}
                aria-label="닫기"
              >✕</button>
            </div>
            {feasSettings.loadState === "loading" && (
              <p className="feas-settings-loading">불러오는 중…</p>
            )}
            {feasSettings.loadState === "error" && (
              <p className="feas-settings-err" role="alert">불러오기 실패 — 현재 값으로 조정할게</p>
            )}
            {(feasSettings.loadState === "ready" || feasSettings.loadState === "error") && (() => {
              const { draft, limits, saving, saveError, preview, previewError } = feasSettings;
              const PARAM_LABELS: Record<keyof UpdateFeasibilityParamsRequest, string> = {
                energyBudget: "에너지 예산",
                meetBufferMinutes: "미팅 버퍼",
                deepBufferMinutes: "집중 버퍼",
                travelMargin: "이동 여유",
                maxContinuousMinutes: "최대 연속"
              };
              return (
                <div className="feas-settings-body">
                  {(Object.keys(PARAM_LABELS) as (keyof UpdateFeasibilityParamsRequest)[]).map((key) => {
                    const lim = limits[key];
                    const val = draft[key];
                    return (
                      <div key={key} className="feas-param-row">
                        <label className="feas-param-label" htmlFor={`feas-slider-${key}`}>
                          {PARAM_LABELS[key]}
                          <span className="feas-param-unit">{lim.unit}</span>
                        </label>
                        <div className="feas-param-control">
                          <input
                            id={`feas-slider-${key}`}
                            type="range"
                            className="feas-slider"
                            min={lim.min}
                            max={lim.max}
                            step={lim.step}
                            value={val}
                            onChange={(e) => handleFeasSliderChange(key, Number(e.target.value), surface)}
                            disabled={saving}
                            aria-label={`${PARAM_LABELS[key]} ${val}${lim.unit}`}
                          />
                          <span className="feas-param-val">{val}</span>
                        </div>
                      </div>
                    );
                  })}
                  {previewError && (
                    <p className="feas-settings-err" role="alert">{previewError}</p>
                  )}
                  {preview && (
                    <div className="feas-preview" aria-label="미리보기 결과">
                      <span className="feas-preview-label">미리보기</span>
                      <span className="feas-preview-val">
                        {preview.energy.loadUnits.toFixed(1)}h / {preview.energy.budgetUnits}h
                        {preview.energy.deficit && " · 초과"}
                      </span>
                    </div>
                  )}
                  {saveError && (
                    <p className="feas-settings-err" role="alert">{saveError}</p>
                  )}
                  <div className="feas-settings-actions">
                    <button
                      className="feas-settings-cancel-btn"
                      onClick={handleCloseFeasSettings}
                      disabled={saving}
                    >
                      취소
                    </button>
                    <button
                      className="feas-settings-apply-btn"
                      onClick={() => void handleApplyFeasSettings()}
                      disabled={saving}
                      aria-label="파라미터 저장"
                    >
                      {saving ? "저장 중…" : "적용"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </>
  );
}
