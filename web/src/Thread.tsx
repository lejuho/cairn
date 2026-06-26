import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovePromotionRequest, EgoGraphData, EventMode, EventRow, PromotionSuggestion, TaskRow, ThreadDetail, ThreadLinkKind, ThreadNodeLink, ThreadResourceFocusData, ThreadResourceFocusItem, ThreadRollup, ThreadRow, ThreadSummary, ThreadUnknownBlocker } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";
import { EgoSheet, loadEgoGraph } from "./EgoSheet.js";

// Thread node edit/confirm endpoints (cycle-50 FR-THR-05/06). Return ok+optional
// error; callers refresh thread detail on success.
async function patchEventNode(id: number, body: Record<string, unknown>) {
  return apiJson<{ ok: boolean; error?: { code: string; message: string } }>(`/api/events/${id}/thread-node`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}
async function patchTaskNode(id: number, body: Record<string, unknown>) {
  return apiJson<{ ok: boolean; error?: { code: string; message: string } }>(`/api/tasks/${id}/thread-node`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}
async function confirmNodeLink(threadId: number, linkId: number) {
  return apiJson<{ ok: boolean; error?: { code: string; message: string } }>(`/api/threads/${threadId}/node-links/${linkId}/confirm`, {
    method: "PATCH"
  });
}

const LINK_FIRMNESS_LABEL: Record<string, string> = { hard: "확정", soft: "약함", tentative: "잠정" };
const LINK_SOURCE_LABEL: Record<string, string> = { authored: "직접", given: "주어짐", inferred: "추론" };

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

async function loadResourceFocus(id: number): Promise<ThreadResourceFocusData | null> {
  try {
    const body = await apiJson<{ ok: boolean; data?: ThreadResourceFocusData }>(`/api/threads/${id}/resource-focus`);
    return body.ok ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

async function loadPromotionSuggestions(threadId: number): Promise<PromotionSuggestion[]> {
  try {
    const body = await apiJson<{ ok: boolean; data?: { suggestions: PromotionSuggestion[] } }>(
      `/api/resources/promotion-suggestions?threadId=${threadId}`
    );
    return body.ok ? (body.data?.suggestions ?? []) : [];
  } catch {
    return [];
  }
}

export function Thread({ id }: { id: number }) {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [linkSheet, setLinkSheet] = useState<LinkSheetState>({ tag: "closed" });
  const [focus, setFocus] = useState<ThreadResourceFocusData | null>(null);
  const [activeResourceId, setActiveResourceId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<PromotionSuggestion[]>([]);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const sheetBackdropRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setView({ tag: "loading" });
    Promise.all([loadThread(id), loadResourceFocus(id), loadPromotionSuggestions(id)])
      .then(([detail, focusData, suggestionsData]) => {
        setView({ tag: "live", detail });
        setFocus(focusData);
        setSuggestions(suggestionsData);
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
    Promise.all([loadThread(id), loadResourceFocus(id), loadPromotionSuggestions(id)])
      .then(([detail, focusData, suggestionsData]) => {
        if (!cancelled) {
          setView({ tag: "live", detail });
          setFocus(focusData);
          setSuggestions(suggestionsData);
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

  async function handleApprove(suggestion: PromotionSuggestion) {
    if (approvingKey != null) return;
    setApprovingKey(suggestion.candidateKey);
    setApproveError(null);
    try {
      const req: ApprovePromotionRequest = {
        candidateKey: suggestion.candidateKey,
        name: suggestion.name,
        kind: suggestion.kind,
        occurrences: suggestion.occurrences,
        threadId: id
      };
      const body = await apiJson<{ ok: boolean; error?: { code: string; message: string } }>(
        "/api/resources/promotion-suggestions/approve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req)
        }
      );
      if (!body.ok) {
        const code = body.error?.code ?? "";
        const msg = code === "PROMOTION_STALE"
          ? "제안이 바뀌었어. 새로고침 후 다시 해봐."
          : code === "PROMOTION_NOT_ELIGIBLE"
            ? "이 제안은 더 이상 유효하지 않아."
            : body.error?.message ?? "승인 중 오류가 발생했어";
        setApproveError(msg);
      } else {
        // Refresh all three: thread, focus, suggestions
        refresh();
      }
    } catch {
      setApproveError("승인 중 오류가 발생했어. 다시 시도해봐.");
    } finally {
      setApprovingKey(null);
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

  // Compute highlighted ids for the active resource.
  const activeItem = focus?.resources.find((r) => r.resource.id === activeResourceId) ?? null;
  const highlightedEventIds = new Set<number>(
    activeItem?.links.filter((l) => l.targetType === "event").map((l) => l.targetId) ?? []
  );
  const highlightedTaskIds = new Set<number>(
    activeItem?.links.filter((l) => l.targetType === "task").map((l) => l.targetId) ?? []
  );
  const highlightThread = activeItem?.links.some((l) => l.targetType === "thread") ?? false;

  function nodeClass(base: string, highlighted: boolean): string {
    if (activeResourceId == null) return base;
    return highlighted ? `${base} resource-highlight` : `${base} resource-dimmed`;
  }

  return (
    <>
      <main className="app-shell today-live" aria-labelledby="thread-title" inert={linkSheet.tag === "open" ? true : undefined}>
        <div
          className={nodeClass("thread-header", highlightThread)}
          data-testid="thread-header"
          style={{ width: "min(100%, 480px)", marginBottom: "16px" }}
        >
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
            <TaskNodeCard
              key={`task-${task.id}`}
              task={task}
              liClassName={nodeClass("today-card today-card--task", highlightedTaskIds.has(task.id))}
              chip="작업"
              onSaved={refresh}
            />
          ))}

          {futureEvents.map((event) => (
            <EventNodeCard
              key={`event-${event.id}`}
              event={event}
              liClassName={nodeClass("today-card today-card--event", highlightedEventIds.has(event.id))}
              chip="예정"
              onSaved={refresh}
            />
          ))}

          {(pastEvents.length > 0 || doneTasks.length > 0) && (
            <li className="thread-divider" aria-hidden="true">
              <span className="thread-divider-label">지난 항목</span>
            </li>
          )}

          {pastEvents.map((event) => (
            <EventNodeCard
              key={`event-past-${event.id}`}
              event={event}
              liClassName={nodeClass("today-card today-card--event thread-node--past", highlightedEventIds.has(event.id))}
              chip={event.status === "done" ? "완료" : event.start ? "지남" : "미정"}
              onSaved={refresh}
            />
          ))}

          {doneTasks.map((task) => (
            <TaskNodeCard
              key={`task-done-${task.id}`}
              task={task}
              liClassName={nodeClass("today-card today-card--task thread-node--past", highlightedTaskIds.has(task.id))}
              chip={task.status === "dropped" ? "드롭" : "완료"}
              onSaved={refresh}
            />
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

        {detail.nodeLinks.length > 0 && (
          <NodeLinksSection threadId={detail.thread.id} nodeLinks={detail.nodeLinks} onConfirmed={refresh} />
        )}

        {detail.unknownBlockers.length > 0 && (
          <UnknownBlockersSection blockers={detail.unknownBlockers} />
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

        {/* Resource focus section (FR-XREL cycle-38) */}
        {focus && focus.resources.length > 0 && (
          <ResourceFocusSection
            focus={focus}
            activeResourceId={activeResourceId}
            onSelect={(rid) => setActiveResourceId((prev) => (prev === rid ? null : rid))}
          />
        )}

        {/* Promotion suggestions panel (FR-XREL-01 cycle-39) */}
        {suggestions.length > 0 && (
          <PromotionSuggestionsPanel
            suggestions={suggestions}
            approvingKey={approvingKey}
            error={approveError}
            onApprove={(s) => void handleApprove(s)}
            onDismissError={() => setApproveError(null)}
          />
        )}

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

// Event node card (cycle-50 FR-THR-06). Display + inline 수정 form for
// title/type/location/mode. GCal events are read-only (no 수정 button).
function EventNodeCard({ event, liClassName, chip, onSaved }: { event: EventRow; liClassName: string; chip: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const editable = event.source !== "gcal";
  return (
    <li className={liClassName} data-event-id={event.id}>
      {!editing && (
        <>
          <span className="card-chip">{chip}</span>
          <p className="card-title">{event.title}</p>
          {event.start && (
            <p className="card-meta">
              {event.start.slice(0, 16).replace("T", " ")}
              {event.end ? ` — ${event.end.slice(11, 16)}` : ""}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          )}
          {editable && (
            <button className="thread-node-edit-btn" data-testid={`event-edit-${event.id}`} onClick={() => setEditing(true)}>수정</button>
          )}
        </>
      )}
      {editing && (
        <EventNodeForm event={event} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />
      )}
    </li>
  );
}

function EventNodeForm({ event, onCancel, onSaved }: { event: EventRow; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(event.title);
  const [type, setType] = useState(event.type ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [mode, setMode] = useState<EventMode | "">(event.mode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      type: type.trim() === "" ? null : type.trim(),
      location: location.trim() === "" ? null : location.trim(),
      mode: mode === "" ? null : mode
    };
    try {
      const res = await patchEventNode(event.id, body);
      if (!res.ok) { setError(res.error?.message ?? "저장 실패"); setSaving(false); return; }
      onSaved();
    } catch {
      setError("저장 실패"); setSaving(false);
    }
  }

  return (
    <form className="thread-node-form" data-testid={`event-form-${event.id}`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="thread-node-field"><span>제목</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="이벤트 제목" />
      </label>
      <label className="thread-node-field"><span>유형</span>
        <input value={type} onChange={(e) => setType(e.target.value)} aria-label="이벤트 유형" />
      </label>
      <label className="thread-node-field"><span>장소</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} aria-label="이벤트 장소" />
      </label>
      <label className="thread-node-field"><span>방식</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as EventMode | "")} aria-label="이벤트 방식">
          <option value="">미정</option>
          <option value="in_person">대면</option>
          <option value="remote">원격</option>
          <option value="async">비동기</option>
        </select>
      </label>
      {error && <p className="card-meta" role="alert" style={{ color: "var(--moved)" }}>{error}</p>}
      <div className="thread-node-form-actions">
        <button type="submit" className="thread-node-save-btn" disabled={saving || title.trim() === ""}>{saving ? "저장 중…" : "저장"}</button>
        <button type="button" className="thread-node-cancel-btn" onClick={onCancel} disabled={saving}>취소</button>
      </div>
    </form>
  );
}

// Task node card (cycle-50 FR-THR-06). Inline 수정 for title/estMinutes/due/
// context/optional.
function TaskNodeCard({ task, liClassName, chip, onSaved }: { task: TaskRow; liClassName: string; chip: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className={liClassName} data-task-id={task.id}>
      {!editing && (
        <>
          <span className="card-chip">{chip}</span>
          <p className="card-title">{task.title}</p>
          {task.context && <p className="card-meta">{task.context}</p>}
          <button className="thread-node-edit-btn" data-testid={`task-edit-${task.id}`} onClick={() => setEditing(true)}>수정</button>
        </>
      )}
      {editing && (
        <TaskNodeForm task={task} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />
      )}
    </li>
  );
}

function TaskNodeForm({ task, onCancel, onSaved }: { task: TaskRow; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [est, setEst] = useState(task.estMinutes != null ? String(task.estMinutes) : "");
  const [due, setDue] = useState(task.due ?? "");
  const [context, setContext] = useState(task.context ?? "");
  const [optional, setOptional] = useState(task.optional === 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      estMinutes: est.trim() === "" ? null : Number(est),
      due: due.trim() === "" ? null : due.trim(),
      context: context.trim() === "" ? null : context.trim(),
      optional
    };
    try {
      const res = await patchTaskNode(task.id, body);
      if (!res.ok) { setError(res.error?.message ?? "저장 실패"); setSaving(false); return; }
      onSaved();
    } catch {
      setError("저장 실패"); setSaving(false);
    }
  }

  return (
    <form className="thread-node-form" data-testid={`task-form-${task.id}`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="thread-node-field"><span>제목</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="작업 제목" />
      </label>
      <label className="thread-node-field"><span>예상(분)</span>
        <input value={est} inputMode="numeric" onChange={(e) => setEst(e.target.value)} aria-label="작업 예상 분" />
      </label>
      <label className="thread-node-field"><span>마감</span>
        <input value={due} placeholder="YYYY-MM-DD" onChange={(e) => setDue(e.target.value)} aria-label="작업 마감일" />
      </label>
      <label className="thread-node-field"><span>맥락</span>
        <input value={context} onChange={(e) => setContext(e.target.value)} aria-label="작업 맥락" />
      </label>
      <label className="thread-node-field thread-node-field--check">
        <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} aria-label="선택 작업" />
        <span>선택 작업</span>
      </label>
      {error && <p className="card-meta" role="alert" style={{ color: "var(--moved)" }}>{error}</p>}
      <div className="thread-node-form-actions">
        <button type="submit" className="thread-node-save-btn" disabled={saving || title.trim() === ""}>{saving ? "저장 중…" : "저장"}</button>
        <button type="button" className="thread-node-cancel-btn" onClick={onCancel} disabled={saving}>취소</button>
      </div>
    </form>
  );
}

// Node links section (cycle-50 FR-THR-05). Shows event/task dependency links
// with firmness/source evidence; non-confirmed links get an explicit 확인 button.
function NodeLinksSection({ threadId, nodeLinks, onConfirmed }: { threadId: number; nodeLinks: ThreadNodeLink[]; onConfirmed: () => void }) {
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(linkId: number) {
    setConfirmingId(linkId); setError(null);
    try {
      const res = await confirmNodeLink(threadId, linkId);
      if (!res.ok) { setError(res.error?.message ?? "확인 실패"); setConfirmingId(null); return; }
      onConfirmed();
    } catch {
      setError("확인 실패"); setConfirmingId(null);
    }
  }

  return (
    <section aria-labelledby="thread-node-links-title" data-testid="thread-node-links" style={{ width: "min(100%, 480px)", marginTop: "24px" }}>
      <h2 id="thread-node-links-title" className="eyebrow" style={{ margin: "0 0 8px" }}>노드 연결</h2>
      {error && <p className="card-meta" role="alert" style={{ color: "var(--moved)" }}>{error}</p>}
      <ul className="today-stack" role="list">
        {nodeLinks.map((link) => {
          const confirmed = link.firmness === "hard" && link.source === "authored";
          return (
            <li key={link.id} className="today-card" data-testid={`node-link-${link.id}`}>
              <p className="card-title">{link.from.title} → {link.to.title}</p>
              <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                <span className="card-chip">{link.kind}</span>
                <span className="card-chip" data-testid={`node-link-firmness-${link.id}`}>{LINK_FIRMNESS_LABEL[link.firmness] ?? link.firmness}</span>
                <span className="card-chip">{LINK_SOURCE_LABEL[link.source] ?? link.source}</span>
              </p>
              {confirmed ? (
                <p className="card-meta" data-testid={`node-link-confirmed-${link.id}`}>사용자 확정됨</p>
              ) : (
                <button
                  className="thread-node-confirm-btn"
                  data-testid={`node-link-confirm-${link.id}`}
                  disabled={confirmingId === link.id}
                  onClick={() => void confirm(link.id)}
                >
                  {confirmingId === link.id ? "확인 중…" : "확인"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Unknown blockers (cycle-52 FR-THR-04). Read-only "입력 필요" diagnostics:
// which missing upstream input blocks a downstream node's reverse planning.
// Read-only — existing node 수정 buttons fill the gap (no auto-action).
const BLOCKER_MISSING_LABEL: Record<string, string> = {
  "task.estMinutes": "예상 소요 시간",
  "event.start": "시작 시각",
  "event.end": "종료 시각"
};

function UnknownBlockersSection({ blockers }: { blockers: ThreadUnknownBlocker[] }) {
  return (
    <section aria-labelledby="thread-unknown-blockers-title" data-testid="thread-unknown-blockers" style={{ width: "min(100%, 480px)", marginTop: "24px" }}>
      <h2 id="thread-unknown-blockers-title" className="eyebrow" style={{ margin: "0 0 8px" }}>입력 필요</h2>
      <ul className="today-stack" role="list">
        {blockers.map((b) => (
          <li key={b.id} className="today-card" data-testid={`unknown-blocker-${b.id}`}>
            <p className="card-title">{b.prerequisite.title} → {b.blockedNode.title}</p>
            <p className="card-meta">{b.message}</p>
            <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              <span className="card-chip" data-testid={`blocker-missing-${b.id}`}>{BLOCKER_MISSING_LABEL[b.missingField] ?? b.missingField} 없음</span>
              <span className="card-chip">{b.linkKind}</span>
              <span className="card-chip" data-testid={`blocker-firmness-${b.id}`}>{LINK_FIRMNESS_LABEL[b.firmness] ?? b.firmness}</span>
              <span className="card-chip">{LINK_SOURCE_LABEL[b.source] ?? b.source}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
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
        <p className="card-meta" role="note" style={{ color: "var(--moved)", marginBottom: "8px" }} data-testid="rollup-warning">
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
              <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
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

const FIRMNESS_LABEL: Record<string, string> = {
  hard: "확정",
  soft: "연결",
  tentative: "가능성"
};

function ResourceFocusSection({
  focus,
  activeResourceId,
  onSelect
}: {
  focus: ThreadResourceFocusData;
  activeResourceId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <section
      aria-labelledby="resource-focus-title"
      style={{ width: "min(100%, 480px)", marginTop: "24px" }}
      data-testid="resource-focus"
    >
      <h2 id="resource-focus-title" className="eyebrow" style={{ marginBottom: "8px" }}>관련 리소스</h2>
      <ul className="resource-chip-list" role="list" style={{ display: "flex", flexWrap: "wrap", gap: "8px", listStyle: "none", padding: 0, margin: "0 0 8px" }}>
        {focus.resources.map((item) => (
          <li key={item.resource.id}>
            <button
              className={`resource-chip${activeResourceId === item.resource.id ? " resource-chip--active" : ""}`}
              onClick={() => onSelect(item.resource.id)}
              aria-pressed={activeResourceId === item.resource.id}
              data-resource-id={item.resource.id}
            >
              {item.resource.name}
            </button>
          </li>
        ))}
      </ul>
      {activeResourceId != null && (
        <ResourceFocusDetail item={focus.resources.find((r) => r.resource.id === activeResourceId) ?? null} />
      )}
    </section>
  );
}

function PromotionSuggestionsPanel({
  suggestions,
  approvingKey,
  error,
  onApprove,
  onDismissError
}: {
  suggestions: PromotionSuggestion[];
  approvingKey: string | null;
  error: string | null;
  onApprove: (s: PromotionSuggestion) => void;
  onDismissError: () => void;
}) {
  return (
    <section
      aria-labelledby="promotion-suggestions-title"
      style={{ width: "min(100%, 480px)", marginTop: "24px" }}
      data-testid="promotion-suggestions"
    >
      <h2 id="promotion-suggestions-title" className="eyebrow" style={{ marginBottom: "8px" }}>리소스 제안</h2>

      {error && (
        <p className="today-reply-error" role="alert" style={{ marginBottom: "8px" }}>
          {error}{" "}
          <button
            className="action-btn action-btn--sm"
            onClick={onDismissError}
            aria-label="오류 닫기"
            style={{ marginLeft: "8px" }}
          >
            ✕
          </button>
        </p>
      )}

      <ul className="today-stack" role="list">
        {suggestions.map((s) => {
          const isApproving = approvingKey === s.candidateKey;
          const kindLabel = s.kind === "item" ? "물건" : "지식";
          return (
            <li key={s.candidateKey} className="today-card" data-testid="promotion-suggestion-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div>
                  <span className="card-chip">{kindLabel}</span>
                  <p className="card-title" style={{ margin: "4px 0 2px" }}>
                    {s.name}
                  </p>
                  <p className="card-meta" style={{ opacity: 0.8 }}>
                    {s.name}이(가) {s.occurrenceCount}곳에 나타나. 리소스로 묶을까?
                  </p>
                </div>
                <button
                  className="today-submit-btn"
                  style={{ whiteSpace: "nowrap", minWidth: "60px", padding: "8px 12px" }}
                  onClick={() => onApprove(s)}
                  disabled={approvingKey != null}
                  aria-label={`${s.name} 리소스로 승인`}
                  data-testid="promotion-approve-btn"
                >
                  {isApproving ? "..." : "묶기"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type EgoSheetState =
  | { tag: "closed" }
  | { tag: "loading" }
  | { tag: "open"; graph: EgoGraphData }
  | { tag: "error"; message: string };

function ResourceFocusDetail({ item }: { item: ThreadResourceFocusItem | null }) {
  const [egoState, setEgoState] = useState<EgoSheetState>({ tag: "closed" });

  if (!item) return null;

  async function handleOpenEgo() {
    setEgoState({ tag: "loading" });
    const graph = await loadEgoGraph("resource", item!.resource.id);
    if (graph) {
      setEgoState({ tag: "open", graph });
    } else {
      setEgoState({ tag: "error", message: "관계 정보를 불러올 수 없습니다." });
    }
  }

  return (
    <div className="resource-detail" data-testid="resource-detail">
      <p className="card-meta" style={{ marginBottom: "4px" }}>
        {item.resource.kind === "item" ? "물건" : "지식"}
        {item.sourcePerson && ` · 출처: ${item.sourcePerson.name}`}
      </p>
      {item.resource.note && <p className="card-meta" style={{ opacity: 0.8 }}>{item.resource.note}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
        {item.links.map((link, i) => (
          <li key={i} className="resource-link-row" data-firmness={link.firmness}>
            <span className={`resource-firmness resource-firmness--${link.firmness}`}>
              {FIRMNESS_LABEL[link.firmness]}
            </span>
            <span className="card-meta">
              {link.targetType === "event" ? "이벤트" : link.targetType === "task" ? "작업" : "스레드"} #{link.targetId}
              {link.reason && ` — ${link.reason}`}
            </span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: "8px" }}>
        <button
          className="btn-secondary"
          onClick={handleOpenEgo}
          data-testid="ego-open-btn"
          disabled={egoState.tag === "loading"}
        >
          {egoState.tag === "loading" ? "불러오는 중…" : "작은 관계 보기"}
        </button>
        {egoState.tag === "error" && <span className="card-meta" style={{ color: "var(--color-error)", marginLeft: "8px" }}>{egoState.message}</span>}
        {egoState.tag === "open" && (
          <EgoSheet graph={egoState.graph} onClose={() => setEgoState({ tag: "closed" })} />
        )}
      </div>
    </div>
  );
}
