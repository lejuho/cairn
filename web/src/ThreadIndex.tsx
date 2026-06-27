import { useEffect, useState } from "react";
import type { DomainFilter, ThreadSummary } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";
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

export function ThreadIndex() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [domain, setDomain] = useState<DomainFilter>("all");

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
  }, [domain]);

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
          <h1 id="threads-title">로그인이 필요해</h1>
          <p>세션이 만료됐어. 페이지를 새로 고침해봐.</p>
          <button className="thread-index-new-btn" onClick={() => window.location.reload()}>새로 고침</button>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-labelledby="threads-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Threads</p>
          <h1 id="threads-title">불러오지 못했어</h1>
          <p>{view.message}</p>
          <a className="thread-index-new-btn" href="/threads/new">+ 새 스레드</a>
        </section>
      </main>
    );
  }

  if (view.tag === "empty") {
    return (
      <main className="app-shell" aria-labelledby="threads-title" data-testid="threads-empty">
        <section className="quiet-card warm">
          <span className="quiet-dot" aria-hidden="true" />
          <p className="eyebrow">Threads</p>
          <h1 id="threads-title">아직 스레드가 없어</h1>
          <p>작업이나 일정을 맥락으로 묶고 싶을 때 만들어봐.</p>
          <a className="thread-index-new-btn" href="/threads/new">+ 새 스레드</a>
        </section>
      </main>
    );
  }

  const { summaries } = view;
  return (
    <main className="app-shell today-live" aria-labelledby="threads-title">
      <div style={{ width: "min(100%, 480px)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="threads-title" className="eyebrow" style={{ margin: 0 }}>Threads</h2>
        <a className="thread-index-new-btn" href="/threads/new">+ 새 스레드</a>
      </div>
      <div style={{ width: "min(100%, 480px)", marginBottom: "12px" }}>
        <DomainFilterControl value={domain} onChange={setDomain} label="스레드 도메인 필터" />
      </div>
      {summaries.length === 0 ? (
        <p className="card-meta" data-testid="threads-domain-empty">이 도메인에 스레드가 없어.</p>
      ) : (
      <ul className="today-stack" role="list">
        {summaries.map((s) => (
          <li key={s.thread.id} className="today-card thread-index-card">
            <a className="thread-index-link" href={`/threads/${s.thread.id}`} aria-label={s.thread.name}>
              <span className="card-chip">{s.thread.kind ?? "thread"}</span>
              <span className="card-chip" data-testid={`thread-domain-${s.thread.id}`}>{domainLabel(s.thread.domain)}</span>
              <p className="card-title">{s.thread.name}</p>
              <p className="card-meta">
                {s.thread.goal ?? ""}
                {s.totalCount > 0 ? ` · ${s.doneCount}/${s.totalCount}` : ""}
                {s.thread.deadline ? ` · 마감 ${s.thread.deadline}` : ""}
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
        ))}
      </ul>
      )}
    </main>
  );
}
