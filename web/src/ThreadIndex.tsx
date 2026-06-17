import { useEffect, useState } from "react";
import type { ThreadSummary } from "@cairn/shared";

type ViewState =
  | { tag: "loading" }
  | { tag: "empty" }
  | { tag: "live"; summaries: ThreadSummary[] }
  | { tag: "error"; message: string };

async function loadThreads(): Promise<ThreadSummary[]> {
  const res = await fetch("/api/threads");
  const body = (await res.json()) as { ok: boolean; data?: ThreadSummary[]; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

export function ThreadIndex() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadThreads()
      .then((summaries) => {
        if (!cancelled) {
          setView(summaries.length === 0 ? { tag: "empty" } : { tag: "live", summaries });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
        }
      });
    return () => { cancelled = true; };
  }, []);

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
      <ul className="today-stack" role="list">
        {summaries.map((s) => (
          <li key={s.thread.id} className="today-card thread-index-card">
            <a className="thread-index-link" href={`/threads/${s.thread.id}`} aria-label={s.thread.name}>
              <span className="card-chip">{s.thread.kind ?? "thread"}</span>
              <p className="card-title">{s.thread.name}</p>
              <p className="card-meta">
                {s.thread.goal ?? ""}
                {s.totalCount > 0 ? ` · ${s.doneCount}/${s.totalCount}` : ""}
                {s.thread.deadline ? ` · 마감 ${s.thread.deadline}` : ""}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
