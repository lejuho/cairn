import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualExogenousView, ReversePlanView, SourceStability, WatcherDeepRow } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";
import { localDateString } from "./dateUtils.js";
import { ResultCard } from "./ResultCard.js";

type CreateMode = "date_threshold" | "reverse_plan" | "manual_exogenous";
type WatcherCreateResult = { kind: string; label: string };

type ReversePlanStep = { label: string; leadDays: string };

type ScreenState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "access_session" }
  | { tag: "quiet"; queryNow: string }
  | { tag: "live"; watchers: WatcherDeepRow[]; queryNow: string };

type RowError = { id: number; message: string };

export function Watchers() {
  const [screen, setScreen] = useState<ScreenState>({ tag: "loading" });
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("date_threshold");

  // Date-threshold form
  const [createLabel, setCreateLabel] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createThreshold, setCreateThreshold] = useState("");

  // Reverse-plan form
  const [rpLabel, setRpLabel] = useState("");
  const [rpCategory, setRpCategory] = useState("");
  const [rpTargetDate, setRpTargetDate] = useState("");
  const [rpTargetLabel, setRpTargetLabel] = useState("");
  const [rpSafetyDays, setRpSafetyDays] = useState("0");
  const [rpSteps, setRpSteps] = useState<ReversePlanStep[]>([{ label: "", leadDays: "1" }]);

  // Manual-exogenous form
  const [meLabel, setMeLabel] = useState("");
  const [meCategory, setMeCategory] = useState("");
  const [meSourceLabel, setMeSourceLabel] = useState("");
  const [meSourceUrl, setMeSourceUrl] = useState("");
  const [meSourceStability, setMeSourceStability] = useState<SourceStability>("unknown");

  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createResult, setCreateResult] = useState<WatcherCreateResult | null>(null);
  const createLabelRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const date = localDateString();
    const now = new Date().toISOString();
    try {
      const body = await apiJson<{
        ok: boolean;
        data?: { watchers: WatcherDeepRow[] };
        error?: { message: string };
      }>(`/api/watchers?date=${date}&now=${encodeURIComponent(now)}`);
      if (!body.ok) throw new Error(body.error?.message ?? "오류");
      const ws = body.data!.watchers;
      if (ws.length === 0) {
        setScreen({ tag: "quiet", queryNow: now });
      } else {
        setScreen({ tag: "live", watchers: ws, queryNow: now });
      }
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setScreen({ tag: "access_session" });
      } else {
        setScreen({ tag: "error", message: e instanceof Error ? e.message : "알 수 없는 오류" });
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setCreateLabel(""); setCreateCategory(""); setCreateThreshold("");
    setRpLabel(""); setRpCategory(""); setRpTargetDate(""); setRpTargetLabel("");
    setRpSafetyDays("0"); setRpSteps([{ label: "", leadDays: "1" }]);
    setMeLabel(""); setMeCategory(""); setMeSourceLabel(""); setMeSourceUrl(""); setMeSourceStability("unknown");
    setCreateMode("date_threshold");
    setCreateError(null);
    setCreateResult(null);
    setShowCreate(true);
    setTimeout(() => createLabelRef.current?.focus(), 50);
  };

  const closeCreate = () => setShowCreate(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      if (createMode === "date_threshold") {
        if (!createLabel.trim() || !createThreshold) return;
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: createLabel.trim(),
            threshold: createThreshold,
            ...(createCategory.trim() ? { category: createCategory.trim() } : {})
          })
        });
        if (!body.ok) throw new Error(body.error?.message ?? "생성 실패");
      } else if (createMode === "reverse_plan") {
        if (!rpLabel.trim() || !rpTargetDate) return;
        const safetyDays = Math.max(0, Math.min(30, parseInt(rpSafetyDays, 10) || 0));
        const steps = rpSteps.map((s) => ({
          label: s.label.trim(),
          leadDays: Math.max(0, Math.min(365, parseInt(s.leadDays, 10) || 0))
        }));
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers/reverse-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: rpLabel.trim(),
            targetDate: rpTargetDate,
            ...(rpCategory.trim() ? { category: rpCategory.trim() } : {}),
            ...(rpTargetLabel.trim() ? { targetLabel: rpTargetLabel.trim() } : {}),
            safetyDays,
            steps
          })
        });
        if (!body.ok) throw new Error(body.error?.message ?? "생성 실패");
      } else {
        // manual_exogenous
        if (!meLabel.trim()) return;
        const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers/manual-exogenous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: meLabel.trim(),
            ...(meCategory.trim() ? { category: meCategory.trim() } : {}),
            ...(meSourceLabel.trim() ? { sourceLabel: meSourceLabel.trim() } : {}),
            ...(meSourceUrl.trim() ? { sourceUrl: meSourceUrl.trim() } : {}),
            sourceStability: meSourceStability
          })
        });
        if (!body.ok) throw new Error(body.error?.message ?? "생성 실패");
      }
      // Set the result before refetch (cycle-68) so a slow `load()` cannot race it
      // away; the card lives in separate state and survives the list refresh.
      const createdLabel =
        createMode === "date_threshold" ? createLabel.trim()
        : createMode === "reverse_plan" ? rpLabel.trim()
        : meLabel.trim();
      setCreateResult({ kind: "Watcher", label: createdLabel });
      setShowCreate(false);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleArmedToggle = async (id: number, currentArmed: boolean) => {
    setRowErrors((prev) => prev.filter((r) => r.id !== id));
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>(
        `/api/watchers/${id}/armed`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ armed: !currentArmed })
        }
      );
      if (!body.ok) throw new Error(body.error?.message ?? "변경 실패");
      await load();
    } catch (e) {
      setRowErrors((prev) => [
        ...prev.filter((r) => r.id !== id),
        { id, message: e instanceof Error ? e.message : "변경 실패" }
      ]);
    }
  };

  const handleSnooze = async (id: number, queryNow: string) => {
    setRowErrors((prev) => prev.filter((r) => r.id !== id));
    const snoozedUntil = new Date(Date.parse(queryNow) + 86_400_000).toISOString();
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>(
        `/api/watchers/${id}/snooze`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snoozedUntil })
        }
      );
      if (!body.ok) throw new Error(body.error?.message ?? "스누즈 실패");
      await load();
    } catch (e) {
      setRowErrors((prev) => [
        ...prev.filter((r) => r.id !== id),
        { id, message: e instanceof Error ? e.message : "스누즈 실패" }
      ]);
    }
  };

  const renderReversePlanChain = (rp: ReversePlanView) => (
    <div className="watcher-rp-chain">
      <div className="watcher-rp-target">
        <span className="watcher-rp-target-label">{rp.targetLabel}</span>
        <span className="watcher-rp-target-date">{rp.targetDate}</span>
      </div>
      <ol className="watcher-rp-steps" reversed>
        {[...rp.steps].reverse().map((step, revIdx) => {
          const origIdx = rp.steps.length - 1 - revIdx;
          const isNext = origIdx === rp.nextStepIndex;
          const isDone = step.taskStatus === "done" || step.taskStatus === "dropped";
          return (
            <li
              key={step.taskId}
              className={`watcher-rp-step${isNext ? " watcher-rp-step--next" : ""}${isDone ? " watcher-rp-step--done" : ""}`}
            >
              <span className="watcher-rp-step-label">{step.label}</span>
              <span className="watcher-rp-step-date">{step.latestDate}까지</span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const handleManualLog = async (id: number, outcome: "checked_no_signal" | "signal_seen" | "missed_signal") => {
    setRowErrors((prev) => prev.filter((r) => r.id !== id));
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>(
        `/api/watchers/${id}/manual-log`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome, observedAt: new Date().toISOString() })
        }
      );
      if (!body.ok) throw new Error(body.error?.message ?? "로그 실패");
      await load();
    } catch (e) {
      setRowErrors((prev) => [
        ...prev.filter((r) => r.id !== id),
        { id, message: e instanceof Error ? e.message : "로그 실패" }
      ]);
    }
  };

  const renderManualExogenousView = (me: ManualExogenousView) => (
    <div className="watcher-me-view">
      {me.sourceLabel && (
        <p className="watcher-me-source">
          출처: {me.sourceUrl
            ? <a href={me.sourceUrl} target="_blank" rel="noopener noreferrer">{me.sourceLabel}</a>
            : me.sourceLabel}
          {" "}
          <span className="watcher-me-stability">[{stabilityLabel(me.sourceStability)}]</span>
        </p>
      )}
      <p className="watcher-me-summary">
        최근 30일: {me.summary.manualLogCount}회 확인
        {me.summary.signalSeenCount > 0 && ` · 신호 ${me.summary.signalSeenCount}회`}
        {me.summary.missedSignalCount > 0 && ` · 미스 ${me.summary.missedSignalCount}회`}
      </p>
    </div>
  );

  const renderWatcherCard = (w: WatcherDeepRow, queryNow: string) => {
    const rowErr = rowErrors.find((r) => r.id === w.id);
    const isManualB = w.kind === "B" && w.manualExogenous != null;
    return (
      <li key={w.id} className="watcher-card">
        <div className="watcher-card-header">
          <span className="watcher-card-label">{w.label ?? "—"}</span>
          {w.category && <span className="watcher-card-category">{w.category}</span>}
          <span className={`watcher-card-status watcher-card-status--${w.status}`}>{statusLabel(w.status)}</span>
        </div>
        {isManualB && w.manualExogenous
          ? renderManualExogenousView(w.manualExogenous)
          : w.reversePlan
            ? renderReversePlanChain(w.reversePlan)
            : w.threshold && <p className="watcher-card-threshold">마감 {w.threshold}</p>
        }
        <p className="watcher-card-message">{w.message}</p>
        <div className="watcher-card-actions">
          <button
            className="watcher-armed-toggle"
            aria-pressed={w.armed}
            aria-label={w.armed ? `${w.label ?? "watcher"} 비활성화` : `${w.label ?? "watcher"} 활성화`}
            onClick={() => void handleArmedToggle(w.id, w.armed)}
          >
            {w.armed ? "활성" : "비활성"}
          </button>
          {isManualB && (
            <>
              <button
                className="watcher-log-btn watcher-log-btn--no-signal"
                aria-label={`${w.label ?? "watcher"} 신호 없음`}
                onClick={() => void handleManualLog(w.id, "checked_no_signal")}
              >
                신호 없음
              </button>
              <button
                className="watcher-log-btn watcher-log-btn--signal"
                aria-label={`${w.label ?? "watcher"} 신호 확인`}
                onClick={() => void handleManualLog(w.id, "signal_seen")}
              >
                신호 확인
              </button>
              <button
                className="watcher-log-btn watcher-log-btn--miss"
                aria-label={`${w.label ?? "watcher"} 신호 미스`}
                onClick={() => void handleManualLog(w.id, "missed_signal")}
              >
                미스
              </button>
            </>
          )}
          {w.status === "due" && !isManualB && (
            <button
              className="watcher-snooze-btn"
              aria-label={`${w.label ?? "watcher"} 내일 다시 보기`}
              onClick={() => void handleSnooze(w.id, queryNow)}
            >
              내일 다시 보기
            </button>
          )}
        </div>
        {rowErr && (
          <p className="watcher-row-error" role="alert">{rowErr.message}</p>
        )}
      </li>
    );
  };

  const rpStepRows = rpSteps.map((step, i) => (
    <div key={i} className="rp-step-row">
      <input
        className="form-input rp-step-label"
        placeholder={`단계 ${i + 1} 이름`}
        value={step.label}
        onChange={(e) => setRpSteps((prev) => prev.map((s, j) => j === i ? { ...s, label: e.target.value } : s))}
        required
        aria-label={`단계 ${i + 1} 이름`}
      />
      <input
        type="number"
        className="form-input rp-step-lead"
        placeholder="리드타임(일)"
        min={0}
        max={365}
        value={step.leadDays}
        onChange={(e) => setRpSteps((prev) => prev.map((s, j) => j === i ? { ...s, leadDays: e.target.value } : s))}
        required
        aria-label={`단계 ${i + 1} 리드타임`}
      />
      {rpSteps.length > 1 && (
        <button
          type="button"
          className="rp-step-remove"
          aria-label={`단계 ${i + 1} 삭제`}
          onClick={() => setRpSteps((prev) => prev.filter((_, j) => j !== i))}
        >
          ×
        </button>
      )}
    </div>
  ));

  const createSheet = showCreate ? (
    <div className="bottom-sheet-backdrop" onClick={closeCreate} role="dialog" aria-modal="true" aria-label="Watcher 추가">
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="sheet-title">Watcher 추가</h2>

        <div className="create-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "date_threshold"}
            className={`create-mode-tab${createMode === "date_threshold" ? " create-mode-tab--active" : ""}`}
            onClick={() => { setCreateMode("date_threshold"); setCreateError(null); }}
          >
            날짜 기준
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "reverse_plan"}
            className={`create-mode-tab${createMode === "reverse_plan" ? " create-mode-tab--active" : ""}`}
            onClick={() => { setCreateMode("reverse_plan"); setCreateError(null); }}
          >
            역산 계획
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "manual_exogenous"}
            className={`create-mode-tab${createMode === "manual_exogenous" ? " create-mode-tab--active" : ""}`}
            onClick={() => { setCreateMode("manual_exogenous"); setCreateError(null); }}
          >
            수동 확인
          </button>
        </div>

        <form onSubmit={(e) => void handleCreate(e)} className="watcher-create-form">
          {createMode === "manual_exogenous" ? (
            <>
              <label className="form-label">
                이름 <span aria-hidden="true">*</span>
                <input
                  ref={createLabelRef}
                  className="form-input"
                  value={meLabel}
                  onChange={(e) => setMeLabel(e.target.value)}
                  required
                  aria-required="true"
                  aria-label="수동 확인 watcher 이름"
                />
              </label>
              <label className="form-label">
                카테고리
                <input
                  className="form-input"
                  value={meCategory}
                  onChange={(e) => setMeCategory(e.target.value)}
                  aria-label="카테고리"
                />
              </label>
              <label className="form-label">
                출처 이름
                <input
                  className="form-input"
                  value={meSourceLabel}
                  onChange={(e) => setMeSourceLabel(e.target.value)}
                  placeholder="예: 비자 공고 페이지"
                  aria-label="출처 이름"
                />
              </label>
              <label className="form-label">
                출처 URL
                <input
                  type="url"
                  className="form-input"
                  value={meSourceUrl}
                  onChange={(e) => setMeSourceUrl(e.target.value)}
                  placeholder="https://..."
                  aria-label="출처 URL"
                />
              </label>
              <label className="form-label">
                출처 안정성
                <select
                  className="form-input"
                  value={meSourceStability}
                  onChange={(e) => setMeSourceStability(e.target.value as SourceStability)}
                  aria-label="출처 안정성"
                >
                  <option value="unknown">알 수 없음</option>
                  <option value="stable">안정</option>
                  <option value="volatile">변동성 있음</option>
                </select>
              </label>
            </>
          ) : createMode === "date_threshold" ? (
            <>
              <label className="form-label">
                이름 <span aria-hidden="true">*</span>
                <input
                  ref={createLabelRef}
                  className="form-input"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  required
                  aria-required="true"
                  aria-label="watcher 이름"
                />
              </label>
              <label className="form-label">
                카테고리
                <input
                  className="form-input"
                  value={createCategory}
                  onChange={(e) => setCreateCategory(e.target.value)}
                  aria-label="watcher 카테고리"
                />
              </label>
              <label className="form-label">
                마감일 <span aria-hidden="true">*</span>
                <input
                  type="date"
                  className="form-input"
                  value={createThreshold}
                  onChange={(e) => setCreateThreshold(e.target.value)}
                  required
                  aria-required="true"
                  aria-label="watcher 마감일"
                />
              </label>
            </>
          ) : (
            <>
              <label className="form-label">
                watcher 이름 <span aria-hidden="true">*</span>
                <input
                  ref={createLabelRef}
                  className="form-input"
                  value={rpLabel}
                  onChange={(e) => setRpLabel(e.target.value)}
                  required
                  aria-required="true"
                  aria-label="역산 watcher 이름"
                />
              </label>
              <label className="form-label">
                카테고리
                <input
                  className="form-input"
                  value={rpCategory}
                  onChange={(e) => setRpCategory(e.target.value)}
                  aria-label="카테고리"
                />
              </label>
              <label className="form-label">
                목표 이벤트 이름
                <input
                  className="form-input"
                  value={rpTargetLabel}
                  onChange={(e) => setRpTargetLabel(e.target.value)}
                  placeholder="(watcher 이름과 같으면 비워도 됨)"
                  aria-label="목표 이벤트 이름"
                />
              </label>
              <label className="form-label">
                목표 날짜 <span aria-hidden="true">*</span>
                <input
                  type="date"
                  className="form-input"
                  value={rpTargetDate}
                  onChange={(e) => setRpTargetDate(e.target.value)}
                  required
                  aria-required="true"
                  aria-label="목표 날짜"
                />
              </label>
              <label className="form-label">
                안전 여유 일수 (0–30)
                <input
                  type="number"
                  className="form-input"
                  value={rpSafetyDays}
                  min={0}
                  max={30}
                  onChange={(e) => setRpSafetyDays(e.target.value)}
                  aria-label="안전 여유 일수"
                />
              </label>
              <div className="rp-steps-section">
                <p className="form-label-text">단계 (실행 순서대로) <span aria-hidden="true">*</span></p>
                {rpStepRows}
                {rpSteps.length < 8 && (
                  <button
                    type="button"
                    className="rp-add-step"
                    onClick={() => setRpSteps((prev) => [...prev, { label: "", leadDays: "1" }])}
                  >
                    + 단계 추가
                  </button>
                )}
              </div>
            </>
          )}

          {createError && <p className="form-error" role="alert">{createError}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn-secondary" onClick={closeCreate}>취소</button>
            <button type="submit" className="btn-primary" disabled={createSubmitting} aria-label="watcher 저장">
              {createSubmitting ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (screen.tag === "loading") {
    return (
      <main className="app-shell watchers-shell" aria-label="여백 — 로딩 중">
        <div className="skeleton-card" aria-hidden="true" />
        <div className="skeleton-card" aria-hidden="true" />
      </main>
    );
  }

  if (screen.tag === "access_session") {
    return (
      <main className="app-shell watchers-shell">
        <section className="quiet-card warm">
          <p>로그인 세션이 만료됐거나 네트워크가 끊겼어.</p>
          <button className="btn-primary" onClick={() => window.location.assign(window.location.href)}>
            Access 로그인 다시 열기
          </button>
        </section>
      </main>
    );
  }

  if (screen.tag === "error") {
    return (
      <main className="app-shell watchers-shell">
        <section className="quiet-card warm">
          <p role="alert">{screen.message}</p>
          <button className="btn-primary" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  if (screen.tag === "quiet") {
    return (
      <main className="app-shell watchers-shell">
        <section className="quiet-card">
          <span className="quiet-dot" aria-hidden="true" />
          <h1>아직 추가된 watcher가 없어</h1>
          <p>날짜를 기준으로 챙겨야 할 것들을 여기에 등록해둬.</p>
          <button className="btn-primary" onClick={openCreate} aria-label="Watcher 추가">
            + Watcher 추가
          </button>
        </section>
        {createSheet}
      </main>
    );
  }

  // live
  const { watchers, queryNow } = screen;
  const due = watchers.filter((w) => w.status === "due");
  const snoozed = watchers.filter((w) => w.status === "snoozed");
  const quiet = watchers.filter((w) => w.status === "quiet");
  const disarmed = watchers.filter((w) => w.status === "disarmed");
  const unsupported = watchers.filter((w) => w.status === "unsupported");

  return (
    <main className="app-shell watchers-shell">
      <div className="watchers-header">
        <h1 className="watchers-title">여백</h1>
        <button className="btn-primary" onClick={openCreate} aria-label="Watcher 추가">
          + 추가
        </button>
      </div>

      {createResult && (
        <ResultCard
          testId="watcher-result"
          kind={createResult.kind}
          title={createResult.label}
          status="지켜볼 것이 만들어졌어"
          primary={{ label: "지켜볼 것에서 보기", onClick: () => setCreateResult(null) }}
          secondary="아래 목록에서 방금 만든 Watcher를 확인할 수 있어."
        />
      )}

      {due.length > 0 && (
        <section className="watcher-section" aria-labelledby="watcher-due-heading">
          <h2 id="watcher-due-heading" className="watcher-section-heading">확인 필요</h2>
          <ul className="watcher-list" role="list">
            {due.map((w) => renderWatcherCard(w, queryNow))}
          </ul>
        </section>
      )}

      {snoozed.length > 0 && (
        <section className="watcher-section" aria-labelledby="watcher-snoozed-heading">
          <h2 id="watcher-snoozed-heading" className="watcher-section-heading">스누즈 중</h2>
          <ul className="watcher-list" role="list">
            {snoozed.map((w) => renderWatcherCard(w, queryNow))}
          </ul>
        </section>
      )}

      {quiet.length > 0 && (
        <section className="watcher-section" aria-labelledby="watcher-quiet-heading">
          <h2 id="watcher-quiet-heading" className="watcher-section-heading">대기 중</h2>
          <ul className="watcher-list" role="list">
            {quiet.map((w) => renderWatcherCard(w, queryNow))}
          </ul>
        </section>
      )}

      {disarmed.length > 0 && (
        <section className="watcher-section" aria-labelledby="watcher-disarmed-heading">
          <h2 id="watcher-disarmed-heading" className="watcher-section-heading">비활성</h2>
          <ul className="watcher-list" role="list">
            {disarmed.map((w) => renderWatcherCard(w, queryNow))}
          </ul>
        </section>
      )}

      {unsupported.length > 0 && (
        <section className="watcher-section" aria-labelledby="watcher-unsupported-heading">
          <h2 id="watcher-unsupported-heading" className="watcher-section-heading">지원 안 됨</h2>
          <ul className="watcher-list" role="list">
            {unsupported.map((w) => renderWatcherCard(w, queryNow))}
          </ul>
        </section>
      )}

      {createSheet}
    </main>
  );
}

function statusLabel(status: WatcherDeepRow["status"]): string {
  switch (status) {
    case "due": return "확인 필요";
    case "quiet": return "대기";
    case "snoozed": return "스누즈";
    case "disarmed": return "비활성";
    case "unsupported": return "미지원";
  }
}

function stabilityLabel(s: string): string {
  if (s === "stable") return "안정";
  if (s === "volatile") return "변동";
  return "미확인";
}
