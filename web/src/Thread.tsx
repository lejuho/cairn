import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadDetail, ThreadLinkKind, ThreadRollup, ThreadRow, ThreadSummary } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";

type ViewState =
  | { tag: "loading" }
  | { tag: "live"; detail: ThreadDetail }
  | { tag: "error"; message: string }
  | { tag: "access_session_required" };

type LinkSheetState =
  | { tag: "closed" }
  | { tag: "open"; threads: ThreadRow[] | null; toThreadId: string; kind: ThreadLinkKind; submitting: boolean; error: string | null };

const KIND_LABELS: Record<ThreadLinkKind, string> = {
  contains: "포함",
  blocks: "차단",
  feeds: "연결",
  competes: "경쟁",
  shares: "공유"
};
const KINDS: ThreadLinkKind[] = ["contains", "blocks", "feeds", "competes", "shares"];

async function loadThread(id: number): Promise<ThreadDetail> {
  const body = await apiJson<{ ok: boolean; data?: ThreadDetail; error?: { message: string } }>(`/api/threads/${id}`);
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

export function Thread({ id }: { id: number }) {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [linkSheet, setLinkSheet] = useState<LinkSheetState>({ tag: "closed" });
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const sheetBackdropRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setView({ tag: "loading" });
    loadThread(id)
      .then((detail) => {
        setView({ tag: "live", detail });
      })
      .catch((e: unknown) => {
        const err = e as Partial<AccessSessionError>;
        if (err.kind === "access_session_required") {
          setView({ tag: "access_session_required" });
        } else {
          setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
        }
      });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setView({ tag: "loading" });
    loadThread(id)
      .then((detail) => {
        if (!cancelled) {
          setView({ tag: "live", detail });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const err = e as Partial<AccessSessionError>;
          if (err.kind === "access_session_required") {
            setView({ tag: "access_session_required" });
          } else {
            setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
          }
        }
      });
    return () => { cancelled = true; };
  }, [id]);

  function openLinkSheet() {
    setLinkSheet({ tag: "open", threads: null, toThreadId: "", kind: "contains", submitting: false, error: null });
    requestAnimationFrame(() => sheetCloseRef.current?.focus());

    // Resolution after close is a no-op: every setLinkSheet guards on prev.tag === "open".
    apiJson<{ ok: boolean; data?: ThreadSummary[] }>("/api/threads")
      .then((body) => {
        const threads = (body.data ?? []).map((s) => s.thread).filter((t) => t.id !== id);
        setLinkSheet((prev) =>
          prev.tag === "open" ? { ...prev, threads } : prev
        );
      })
      .catch(() => {
        setLinkSheet((prev) =>
          prev.tag === "open" ? { ...prev, threads: [] } : prev
        );
      });
  }

  function closeLinkSheet() {
    setLinkSheet({ tag: "closed" });
    requestAnimationFrame(() => addBtnRef.current?.focus());
  }

  async function handleAddLink() {
    if (linkSheet.tag !== "open" || linkSheet.submitting || !linkSheet.toThreadId) return;
    setLinkSheet((prev) => prev.tag === "open" ? { ...prev, submitting: true, error: null } : prev);
    try {
      const body = await apiJson<{ ok: boolean; error?: { code: string; message: string } }>(
        `/api/threads/${id}/links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toThreadId: Number(linkSheet.toThreadId), kind: linkSheet.kind })
        }
      );
      if (!body.ok) {
        const code = body.error?.code ?? "";
        const msg =
          code === "CONTAINS_CYCLE" ? "이 연결은 순환 구조를 만들어. 다른 방향을 선택해봐."
          : code === "CONTAINS_PARENT_CONFLICT" ? "이 스레드는 이미 다른 상위 스레드가 있어."
          : body.error?.message ?? "오류가 발생했어";
        setLinkSheet((prev) => prev.tag === "open" ? { ...prev, submitting: false, error: msg } : prev);
        return;
      }
      setLinkSheet({ tag: "closed" });
      requestAnimationFrame(() => addBtnRef.current?.focus());
      refresh();
    } catch (e: unknown) {
      const err = e as Partial<AccessSessionError>;
      const msg = err.kind === "access_session_required"
        ? (err.message ?? "로그인 세션이 만료됐어")
        : e instanceof Error ? e.message : "오류";
      setLinkSheet((prev) => prev.tag === "open" ? { ...prev, submitting: false, error: msg } : prev);
    }
  }

  async function handleDeleteLink(linkId: number) {
    try {
      await apiJson<{ ok: boolean }>(`/api/threads/${id}/links/${linkId}`, { method: "DELETE" });
      refresh();
    } catch {
      // non-critical: refresh still runs if delete succeeds, silent on network error
    }
  }

  // Focus trap in sheet
  useEffect(() => {
    if (linkSheet.tag !== "open") return;
    const backdrop = sheetBackdropRef.current;
    if (!backdrop) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { closeLinkSheet(); return; }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        backdrop!.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),[tabindex="0"]')
      ).filter((el) => !el.getAttribute("aria-hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
    backdrop.addEventListener("keydown", handleKeyDown);
    return () => backdrop.removeEventListener("keydown", handleKeyDown);
  }, [linkSheet.tag]);

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="스레드 불러오는 중">
        <div className="today-stack" aria-hidden="true">
          <div className="today-skel" />
          <div className="today-skel today-skel--delay" />
        </div>
      </main>
    );
  }

  if (view.tag === "access_session_required") {
    return (
      <main className="app-shell" aria-labelledby="thread-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Thread</p>
          <h1 id="thread-title">로그인이 필요해</h1>
          <p>세션이 만료됐어. 페이지를 새로 고침해봐.</p>
          <button className="today-submit-btn" onClick={() => window.location.reload()}>새로 고침</button>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-labelledby="thread-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Thread</p>
          <h1 id="thread-title">불러오지 못했어</h1>
          <p>{view.message}</p>
        </section>
      </main>
    );
  }

  const { detail } = view;
  const now = new Date();

  const futureEvents = detail.events.filter(
    (e) => e.start != null && new Date(e.start) > now
  );
  const pastEvents = detail.events.filter(
    (e) => e.start == null || new Date(e.start) <= now
  );

  const doneTasks = detail.tasks.filter((t) => t.status === "done" || t.status === "dropped");
  const activeTasks = detail.tasks.filter((t) => t.status !== "done" && t.status !== "dropped");

  const { progress } = detail;
  const { incoming, outgoing } = detail.relations;
  const hasRelations = incoming.length > 0 || outgoing.length > 0;
  const hasItems = detail.events.length > 0 || detail.tasks.length > 0;

  return (
    <>
      <main className="app-shell today-live" aria-labelledby="thread-title" inert={linkSheet.tag === "open" ? true : undefined}>
        <div className="thread-header" style={{ width: "min(100%, 480px)", marginBottom: "16px" }}>
          <p className="eyebrow">Thread</p>
          <h1 id="thread-title" className="thread-name">{detail.thread.name}</h1>
          {detail.thread.goal && (
            <p className="thread-goal">{detail.thread.goal}</p>
          )}
          <div className="thread-meta-row">
            {detail.thread.deadline && (
              <span className="card-chip">마감 {detail.thread.deadline}</span>
            )}
            {detail.thread.kind && (
              <span className="card-chip">{detail.thread.kind}</span>
            )}
            {progress.total > 0 && (
              <span className="card-chip" aria-label={`진행 ${progress.done}/${progress.total}`}>
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
        </div>

        <ul className="today-stack" role="list" style={{ width: "min(100%, 480px)" }}>
          {activeTasks.map((task) => (
            <li key={`task-${task.id}`} className="today-card today-card--task">
              <span className="card-chip">작업</span>
              <p className="card-title">{task.title}</p>
              {task.context && <p className="card-meta">{task.context}</p>}
            </li>
          ))}

          {futureEvents.map((event) => (
            <li key={`event-${event.id}`} className="today-card today-card--event">
              <span className="card-chip">예정</span>
              <p className="card-title">{event.title}</p>
              <p className="card-meta">
                {event.start?.slice(0, 16).replace("T", " ")}
                {event.end ? ` — ${event.end.slice(11, 16)}` : ""}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </li>
          ))}

          {(pastEvents.length > 0 || doneTasks.length > 0) && (
            <li className="thread-divider" aria-hidden="true">
              <span className="thread-divider-label">지난 항목</span>
            </li>
          )}

          {pastEvents.map((event) => (
            <li key={`event-past-${event.id}`} className="today-card today-card--event thread-node--past">
              <span className="card-chip">{event.status === "done" ? "완료" : event.start ? "지남" : "미정"}</span>
              <p className="card-title">{event.title}</p>
              {event.start && (
                <p className="card-meta">
                  {event.start.slice(0, 16).replace("T", " ")}
                  {event.end ? ` — ${event.end.slice(11, 16)}` : ""}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
              )}
            </li>
          ))}

          {doneTasks.map((task) => (
            <li key={`task-done-${task.id}`} className="today-card today-card--task thread-node--past">
              <span className="card-chip">{task.status === "dropped" ? "드롭" : "완료"}</span>
              <p className="card-title">{task.title}</p>
            </li>
          ))}
        </ul>

        {!hasItems && (
          <p
            className="card-meta"
            data-testid="thread-empty"
            style={{ width: "min(100%, 480px)", padding: "8px 0", opacity: 0.8 }}
          >
            아직 연결된 항목이 없어. 이벤트나 작업을 연결하면 여기 나타나.
          </p>
        )}

        {/* Relations section */}
        <section
          aria-labelledby="thread-relations-title"
          style={{ width: "min(100%, 480px)", marginTop: "24px" }}
          data-testid="thread-relations"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h2 id="thread-relations-title" className="eyebrow" style={{ margin: 0 }}>관계</h2>
            <button
              ref={addBtnRef}
              className="action-btn action-btn--sm"
              onClick={openLinkSheet}
              aria-label="관계 추가"
            >
              + 연결
            </button>
          </div>

          {!hasRelations && (
            <p className="card-meta" style={{ padding: "8px 0" }}>아직 연결된 스레드가 없어</p>
          )}

          {outgoing.length > 0 && (
            <ul className="today-stack" role="list" style={{ marginBottom: "8px" }}>
              {outgoing.map((rel) => (
                <li key={rel.id} className="today-card thread-relation-card" data-testid="outgoing-relation">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span className="card-chip">{KIND_LABELS[rel.kind]}</span>
                      <span className="card-chip" style={{ opacity: 0.7 }}>→</span>
                      <a href={`/threads/${rel.toThread.id}`} className="card-title">{rel.toThread.name}</a>
                    </div>
                    <button
                      className="action-btn action-btn--sm"
                      onClick={() => void handleDeleteLink(rel.id)}
                      aria-label={`${rel.toThread.name} 관계 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {incoming.length > 0 && (
            <ul className="today-stack" role="list">
              {incoming.map((rel) => (
                <li key={rel.id} className="today-card thread-relation-card thread-relation-card--incoming" data-testid="incoming-relation">
                  <span className="card-chip">{KIND_LABELS[rel.kind]}</span>
                  <span className="card-chip" style={{ opacity: 0.7 }}>←</span>
                  <a href={`/threads/${rel.fromThread.id}`} className="card-title">{rel.fromThread.name}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Rollup section (FR-THR-10 Rollup A) */}
        <ThreadRollupSection rollup={detail.rollup} />
      </main>

      {linkSheet.tag === "open" && (
        <div
          ref={sheetBackdropRef}
          className="sheet-backdrop"
          role="presentation"
          onClick={(e) => {
            if (!linkSheet.submitting && e.target === sheetBackdropRef.current) closeLinkSheet();
          }}
        >
          <div
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-sheet-title"
          >
            <div aria-hidden="true" tabIndex={0} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 id="link-sheet-title" className="eyebrow" style={{ margin: 0 }}>스레드 연결</h2>
              <button
                ref={sheetCloseRef}
                className="sheet-close"
                aria-label="닫기"
                onClick={closeLinkSheet}
                disabled={linkSheet.submitting}
              >
                ✕
              </button>
            </div>

            {linkSheet.threads === null ? (
              <p className="card-meta">스레드 목록 불러오는 중...</p>
            ) : linkSheet.threads.length === 0 ? (
              <p className="card-meta">연결할 스레드가 없어</p>
            ) : (
              <>
                <label htmlFor="link-target" className="thread-new-label">대상 스레드</label>
                <select
                  id="link-target"
                  className="thread-new-input"
                  value={linkSheet.toThreadId}
                  onChange={(e) =>
                    setLinkSheet((prev) =>
                      prev.tag === "open" ? { ...prev, toThreadId: e.target.value } : prev
                    )
                  }
                  disabled={linkSheet.submitting}
                >
                  <option value="">선택...</option>
                  {linkSheet.threads.map((t: ThreadRow) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>

                <label htmlFor="link-kind" className="thread-new-label">관계 종류</label>
                <select
                  id="link-kind"
                  className="thread-new-input"
                  value={linkSheet.kind}
                  onChange={(e) =>
                    setLinkSheet((prev) =>
                      prev.tag === "open" ? { ...prev, kind: e.target.value as ThreadLinkKind } : prev
                    )
                  }
                  disabled={linkSheet.submitting}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>

                {linkSheet.error && (
                  <p className="today-reply-error" role="alert">{linkSheet.error}</p>
                )}

                <button
                  className="today-submit-btn"
                  onClick={() => void handleAddLink()}
                  disabled={!linkSheet.toThreadId || linkSheet.submitting}
                  style={{ marginTop: "12px" }}
                >
                  {linkSheet.submitting ? "..." : "연결하기 →"}
                </button>
              </>
            )}
            <div aria-hidden="true" tabIndex={0} />
          </div>
        </div>
      )}
    </>
  );
}

function ThreadRollupSection({ rollup }: { rollup: ThreadRollup }) {
  const hasChildren = rollup.children.length > 0;

  return (
    <section
      aria-labelledby="thread-rollup-title"
      style={{ width: "min(100%, 480px)", marginTop: "32px" }}
      data-testid="thread-rollup"
    >
      <h2 id="thread-rollup-title" className="eyebrow" style={{ marginBottom: "12px" }}>포함 롤업</h2>

      {rollup.warnings.length > 0 && (
        <p className="card-meta" role="note" style={{ color: "var(--color-warn, #b45309)", marginBottom: "8px" }} data-testid="rollup-warning">
          ⚠ {rollup.warnings.join(", ")}
        </p>
      )}

      {!hasChildren ? (
        <p className="card-meta" style={{ padding: "8px 0", opacity: 0.8 }} data-testid="rollup-no-children">
          포함된 하위 스레드가 아직 없어
        </p>
      ) : (
        <>
          <table className="rollup-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }} data-testid="rollup-metrics">
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 8px 4px 0", opacity: 0.6 }}>구분</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>진행</th>
                <th style={{ textAlign: "right", padding: "4px 0 4px 8px" }}>에너지(h)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "4px 8px 4px 0" }}>직접</td>
                <td style={{ textAlign: "right" }}>{rollup.direct.progress.done}/{rollup.direct.progress.total}</td>
                <td style={{ textAlign: "right", paddingRight: "8px" }}>{rollup.direct.energyHours.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px 4px 0" }}>하위 ({rollup.contains.descendantCount})</td>
                <td style={{ textAlign: "right" }}>{rollup.contains.progress.done}/{rollup.contains.progress.total}</td>
                <td style={{ textAlign: "right", paddingRight: "8px" }}>{rollup.contains.energyHours.toFixed(1)}</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--color-border, #e5e7eb)", fontWeight: 600 }}>
                <td style={{ padding: "4px 8px 4px 0" }}>합계</td>
                <td style={{ textAlign: "right" }}>{rollup.total.progress.done}/{rollup.total.progress.total}</td>
                <td style={{ textAlign: "right", paddingRight: "8px" }}>{rollup.total.energyHours.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>

          <p className="card-meta" style={{ opacity: 0.6, margin: "4px 0 12px", fontSize: "0.75rem" }}>
            누락 비용 모델은 아직 없어
          </p>

          <ul className="today-stack" role="list" style={{ marginTop: "8px" }} data-testid="rollup-children">
            {rollup.children.map((child) => (
              <li key={child.relationId} className="today-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span className="card-chip" style={{ opacity: 0.7 }}>깊이 {child.depth}</span>
                  <a href={`/threads/${child.thread.id}`} className="card-title">{child.thread.name}</a>
                  {child.descendantCount > 0 && (
                    <span className="card-chip" style={{ marginLeft: "4px", opacity: 0.6 }}>+{child.descendantCount}</span>
                  )}
                </div>
                <span className="card-meta" style={{ whiteSpace: "nowrap", paddingLeft: "8px" }}>
                  {child.progress.done}/{child.progress.total} · {child.energyHours.toFixed(1)}h
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
