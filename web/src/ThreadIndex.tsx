import { Board, BoardGrip, type BoardColumnId } from "./Board.js";
import { useEffect, useState } from "react";
import type { DomainFilter, ThreadSummary } from "@cairn/shared";
import { apiJson, type AccessSessionError, openAccessLogin } from "./api.js";
import { DomainFilterControl, domainLabel } from "./DomainFilter.js";

type ViewState =
  | { tag: "loading" }
  | { tag: "empty" }
  | { tag: "live"; summaries: ThreadSummary[] }
  | { tag: "error"; message: string }
  | { tag: "access_session_required" };

async function loadThreads(domain: DomainFilter): Promise<ThreadSummary[]> {
  const body = await apiJson<{ ok: boolean; data?: ThreadSummary[]; error?: { message: string } }>(`/api/threads?domain=${domain}`);
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

// A thread's column is its real state: done → 완료; otherwise 진행 중 once it was started — moved
// there on the board, or something inside it is under way or finished — and 할 일 until then.
function hasInnerProgress(summary: ThreadSummary): boolean {
  return summary.doneCount > 0 || (summary.doingCount ?? 0) > 0;
}

export function placeThread(summary: ThreadSummary): BoardColumnId | "folded" {
  const status = summary.thread.status;
  if (status === "done") return "done";
  if (status === "paused" || status === "dropped") return "folded";
  return summary.thread.startedAt || hasInnerProgress(summary) ? "doing" : "todo";
}

export function ThreadIndex() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [domain, setDomain] = useState<DomainFilter>("all");
  const [reloadSeq, setReloadSeq] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // A card dropped on another column changes the thread's real state, then the list reloads.
  const move = async (cardKey: string, to: BoardColumnId) => {
    const id = Number(cardKey.split(":")[1]);
    const summary = view.tag === "live" ? view.summaries.find((s) => s.thread.id === id) : undefined;
    setNotice(null);
    if (to === "todo" && summary && hasInnerProgress(summary)) {
      setNotice("진행된 항목이 있는 스레드는 할 일로 되돌릴 수 없습니다.");
      return;
    }
    try {
      const res = await apiJson<{ ok: boolean; error?: { message: string } }>(`/api/threads/${id}/board`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: to })
      });
      if (!res.ok) {
        setNotice(res.error?.message ?? "옮기지 못했습니다.");
        return;
      }
      setReloadSeq((n) => n + 1);
    } catch {
      setNotice("옮기지 못했습니다. 다시 시도하세요.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadThreads(domain)
      .then((summaries) => {
        if (!cancelled) {
          // Only an unfiltered empty result is the true "no threads yet" state;
          // an empty domain filter keeps the control visible (live, 0 cards).
          setView(summaries.length === 0 && domain === "all" ? { tag: "empty" } : { tag: "live", summaries });
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
  }, [domain, reloadSeq]);

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="스레드 목록 불러오는 중">
        <div className="today-stack" aria-hidden="true">
          <div className="today-skel" />
          <div className="today-skel today-skel--delay" />
        </div>
      </main>
    );
  }

  if (view.tag === "access_session_required") {
    return (
      <main className="app-shell" aria-labelledby="threads-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Threads</p>
          <h1 id="threads-title">로그인이 필요합니다</h1>
          <p>세션이 만료됐습니다. 페이지를 새로 고침하세요.</p>
          <button className="thread-index-new-btn" onClick={() => openAccessLogin()}>다시 로그인</button>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-labelledby="threads-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Threads</p>
          <h1 id="threads-title">불러오지 못했습니다</h1>
          <p>{view.message}</p>
          <a className="thread-index-new-btn" href="/threads/new">+ 새 스레드</a>
        </section>
      </main>
    );
  }

  if (view.tag === "empty") {
    return (
      <main className="app-shell" aria-labelledby="threads-title" data-testid="threads-empty">
        <section className="quiet-card empty-state">
          <h1 id="threads-title">스레드가 없습니다</h1>
          <a className="empty-add-btn" href="/threads/new">+ 새 스레드</a>
        </section>
      </main>
    );
  }

  const { summaries } = view;
  const card = (s: ThreadSummary) => (
          <li key={s.thread.id} className="today-card thread-index-card">
            <BoardGrip cardKey={`thread:${s.thread.id}`} label={s.thread.name} />
            <a className="thread-index-link" href={`/threads/${s.thread.id}`} aria-label={s.thread.name}>
              <span className="card-chip">{s.thread.kind ?? "thread"}</span>
              <span className="card-chip" data-testid={`thread-domain-${s.thread.id}`}>{domainLabel(s.thread.domain)}</span>
              <p className="card-title">{s.thread.name}</p>
              <p className="card-meta">
                {[s.thread.goal, s.totalCount > 0 ? `${s.doneCount}/${s.totalCount} 완료` : null, s.thread.deadline ? `마감 ${s.thread.deadline}` : null].filter(Boolean).join(" · ")}
              </p>
              {(s.relationCounts.incoming > 0 || s.relationCounts.outgoing > 0) && (
                <p className="card-meta thread-relation-chips" aria-label="관계">
                  {s.relationCounts.incoming > 0 && (
                    <span className="card-chip" aria-label={`들어오는 관계 ${s.relationCounts.incoming}개`}>↑ {s.relationCounts.incoming}</span>
                  )}
                  {s.relationCounts.outgoing > 0 && (
                    <span className="card-chip" aria-label={`나가는 관계 ${s.relationCounts.outgoing}개`}>↓ {s.relationCounts.outgoing}</span>
                  )}
                </p>
              )}
            </a>
          </li>
  );
  const column = (id: BoardColumnId | "folded") => {
    const members = summaries.filter((s) => placeThread(s) === id);
    return { count: members.length, cards: members.map(card) };
  };
  return (
    <main className="app-shell today-live" aria-labelledby="threads-title">
      <div style={{ width: "100%", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="threads-title" className="eyebrow" style={{ margin: 0 }}>Threads</h2>
        <a className="thread-index-new-btn" href="/threads/new">+ 새 스레드</a>
      </div>
      <div style={{ width: "100%", marginBottom: "12px" }}>
        <DomainFilterControl value={domain} onChange={setDomain} label="스레드 도메인 필터" />
      </div>
      {summaries.length === 0 ? (
        <p className="card-meta" data-testid="threads-domain-empty">이 도메인에 스레드가 없습니다.</p>
      ) : (
      <Board
        label="스레드 보드"
        testId="threads-board"
        columns={{ todo: column("todo"), doing: column("doing"), done: column("done") }}
        folded={column("folded")}
        onMove={(cardKey, to) => void move(cardKey, to)}
        notice={notice}
      />
      )}
    </main>
  );
}
