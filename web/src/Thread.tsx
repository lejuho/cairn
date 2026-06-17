import { useEffect, useState } from "react";
import type { ThreadDetail } from "@cairn/shared";

type ViewState =
  | { tag: "loading" }
  | { tag: "empty" }
  | { tag: "live"; detail: ThreadDetail }
  | { tag: "error"; message: string };

async function loadThread(id: number): Promise<ThreadDetail> {
  const res = await fetch(`/api/threads/${id}`);
  const body = (await res.json()) as { ok: boolean; data?: ThreadDetail; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

export function Thread({ id }: { id: number }) {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;
    setView({ tag: "loading" });
    loadThread(id)
      .then((detail) => {
        if (!cancelled) {
          const isEmpty = detail.events.length === 0 && detail.tasks.length === 0;
          setView(isEmpty ? { tag: "empty" } : { tag: "live", detail });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
        }
      });
    return () => { cancelled = true; };
  }, [id]);

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

  if (view.tag === "empty") {
    return (
      <main className="app-shell" aria-labelledby="thread-title" data-testid="thread-empty">
        <section className="quiet-card warm">
          <span className="quiet-dot" aria-hidden="true" />
          <p className="eyebrow">Thread</p>
          <h1 id="thread-title">아직 연결된 항목이 없어</h1>
          <p>이 스레드에 이벤트나 작업을 연결하면 여기 나타나.</p>
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

  return (
    <main className="app-shell today-live" aria-labelledby="thread-title">
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
    </main>
  );
}
