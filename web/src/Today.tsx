import { useCallback, useEffect, useState } from "react";
import type { TodaySurface } from "@cairn/shared";

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet" }
  | { tag: "live"; surface: TodaySurface }
  | { tag: "error"; message: string };

function localDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadSurface(): Promise<TodaySurface> {
  const date = localDateString();
  const now = new Date().toISOString();
  const res = await fetch(`/api/today?date=${date}&now=${encodeURIComponent(now)}`);
  const body = (await res.json()) as { ok: boolean; data?: TodaySurface; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "알 수 없는 오류");
  return body.data!;
}

async function markTaskDone(id: number): Promise<void> {
  const res = await fetch(`/api/tasks/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  if (!res.ok) throw new Error("완료 처리 실패");
}

export function Today() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  const refresh = useCallback(async () => {
    setView({ tag: "loading" });
    try {
      const surface = await loadSurface();
      setView(
        surface.state === "quiet"
          ? { tag: "quiet" }
          : { tag: "live", surface }
      );
    } catch (e) {
      setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDone = useCallback(
    async (taskId: number) => {
      try {
        await markTaskDone(taskId);
        await refresh();
      } catch {
        // noop — refresh will show current state
      }
    },
    [refresh]
  );

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
      <main className="app-shell" aria-labelledby="today-title">
        <section className="quiet-card warm" data-testid="today-quiet">
          <span className="quiet-dot" aria-hidden="true" />
          <p className="eyebrow">Today</p>
          <h1 id="today-title">오늘은 조용해</h1>
          <p>새로 생기면 올려둘게. 닫고 네 일 해도 돼.</p>
        </section>
      </main>
    );
  }

  const { surface } = view;
  return (
    <main className="app-shell today-live" aria-labelledby="today-sr-title">
      <h2 id="today-sr-title" className="sr-only">
        오늘 ({surface.cards.length}건)
      </h2>
      <ul className="today-stack" role="list">
        {surface.cards.map((card, i) => {
          const delay = { animationDelay: `${i * 55}ms` } as React.CSSProperties;

          if (card.kind === "conflict") {
            return (
              <li key={`conflict-${i}`} className="today-card today-card--conflict" style={delay}>
                <span className="card-chip">충돌</span>
                <p className="card-title">
                  {card.pair.a.title} ↔ {card.pair.b.title}
                </p>
                <p className="card-meta">
                  {card.pair.a.start?.slice(11, 16)} — {card.pair.b.end?.slice(11, 16)}
                </p>
              </li>
            );
          }

          if (card.kind === "watcher") {
            return (
              <li key={`watcher-${i}`} className="today-card today-card--watcher" style={delay}>
                <span className="card-chip">기한</span>
                <p className="card-title">{card.watcher.label}</p>
                <p className="card-meta">{card.watcher.threshold}</p>
              </li>
            );
          }

          if (card.kind === "next_event") {
            return (
              <li key={`next_event-${i}`} className="today-card today-card--event" style={delay}>
                <span className="card-chip">다음 일정</span>
                <p className="card-title">{card.event.title}</p>
                <p className="card-meta">
                  {card.event.start?.slice(11, 16)} — {card.event.end?.slice(11, 16)}
                </p>
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

          return null;
        })}
      </ul>
    </main>
  );
}
