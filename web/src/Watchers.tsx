import { useCallback, useEffect, useRef, useState } from "react";
import type { WatcherDeepRow } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";
import { localDateString } from "./dateUtils.js";

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
  const [createLabel, setCreateLabel] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createThreshold, setCreateThreshold] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
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
    setCreateLabel("");
    setCreateCategory("");
    setCreateThreshold("");
    setCreateError(null);
    setShowCreate(true);
    setTimeout(() => createLabelRef.current?.focus(), 50);
  };

  const closeCreate = () => setShowCreate(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createLabel.trim() || !createThreshold) return;
    setCreateSubmitting(true);
    setCreateError(null);
    try {
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

  const renderWatcherCard = (w: WatcherDeepRow, queryNow: string) => {
    const rowErr = rowErrors.find((r) => r.id === w.id);
    return (
      <li key={w.id} className="watcher-card">
        <div className="watcher-card-header">
          <span className="watcher-card-label">{w.label ?? "—"}</span>
          {w.category && <span className="watcher-card-category">{w.category}</span>}
          <span className={`watcher-card-status watcher-card-status--${w.status}`}>{statusLabel(w.status)}</span>
        </div>
        {w.threshold && (
          <p className="watcher-card-threshold">마감 {w.threshold}</p>
        )}
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
          {w.status === "due" && (
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

  const createSheet = showCreate ? (
    <div className="bottom-sheet-backdrop" onClick={closeCreate} role="dialog" aria-modal="true" aria-label="Watcher 추가">
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="sheet-title">Watcher 추가</h2>
        <form onSubmit={(e) => void handleCreate(e)} className="watcher-create-form">
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
