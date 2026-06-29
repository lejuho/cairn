import { useCallback, useEffect, useState } from "react";
import type { EventRow, ItemListData, ItemListScope, TaskRow } from "@cairn/shared";
import { apiJson } from "./api.js";

const EVENT_STATUS_LABEL: Record<string, string> = {
  planned: "계획",
  confirmed: "확정",
  done: "완료",
  cancelled: "취소",
  moved: "이동",
  late: "늦음"
};

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "대기",
  doing: "진행",
  done: "완료",
  dropped: "드롭"
};

function formatEventTime(event: EventRow): string {
  if (!event.start) return "날짜 없음";
  const start = event.start.slice(0, 16).replace("T", " ");
  const end = event.end ? event.end.slice(11, 16) : null;
  return end ? `${start}-${end}` : start;
}

function eventMeta(event: EventRow): string {
  const parts = [formatEventTime(event)];
  if (event.location) parts.push(event.location);
  if (event.threadId != null) parts.push(`스레드 #${event.threadId}`);
  return parts.join(" · ");
}

function taskMeta(task: TaskRow): string {
  const parts = [task.due ? `마감 ${task.due}` : "마감 없음"];
  if (task.estMinutes != null) parts.push(`${task.estMinutes}분`);
  if (task.threadId != null) parts.push(`스레드 #${task.threadId}`);
  return parts.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isEventRow(value: unknown): value is EventRow {
  return isRecord(value) &&
    typeof value.id === "number" &&
    isNullableNumber(value.threadId) &&
    typeof value.title === "string" &&
    isNullableString(value.start) &&
    isNullableString(value.end) &&
    isNullableString(value.location) &&
    isNullableString(value.status) &&
    isNullableString(value.createdAt) &&
    isNullableString(value.updatedAt);
}

function isTaskRow(value: unknown): value is TaskRow {
  return isRecord(value) &&
    typeof value.id === "number" &&
    isNullableNumber(value.threadId) &&
    typeof value.title === "string" &&
    isNullableNumber(value.estMinutes) &&
    isNullableString(value.due) &&
    isNullableString(value.context) &&
    isNullableString(value.status) &&
    isNullableNumber(value.optional) &&
    isNullableString(value.createdAt);
}

function parseList(raw: unknown): ItemListData {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.data)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  const { scope, events, tasks } = raw.data;
  if ((scope !== "active" && scope !== "all") || !Array.isArray(events) || !Array.isArray(tasks)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  if (!events.every(isEventRow) || !tasks.every(isTaskRow)) {
    throw new Error("항목 응답 형식이 맞지 않아");
  }
  return { scope, events, tasks };
}

export function ItemIndex() {
  const [scope, setScope] = useState<ItemListScope>("active");
  const [state, setState] = useState<"loading" | "live" | "error">("loading");
  const [data, setData] = useState<ItemListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextScope: ItemListScope) => {
    setState("loading");
    setError(null);
    try {
      const raw = await apiJson<unknown>(`/api/items?scope=${nextScope}&limit=100`);
      setData(parseList(raw));
      setState("live");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "항목을 불러오지 못했어");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const switchScope = (nextScope: ItemListScope) => {
    if (nextScope !== scope) setScope(nextScope);
  };

  const isQuiet = state === "live" && data != null && data.events.length === 0 && data.tasks.length === 0;

  return (
    <main className="items-page" aria-labelledby="items-title">
      <header className="items-header">
        <div>
          <p className="eyebrow">inventory</p>
          <h1 id="items-title">항목</h1>
        </div>
        <div className="items-scope" role="group" aria-label="항목 범위">
          <button type="button" aria-pressed={scope === "active"} onClick={() => switchScope("active")}>진행 중</button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => switchScope("all")}>전체</button>
        </div>
      </header>

      {state === "loading" && (
        <section className="items-skeleton" aria-label="항목 불러오는 중" data-testid="items-loading">
          <span />
          <span />
          <span />
        </section>
      )}

      {state === "error" && (
        <section className="items-error" role="alert" data-testid="items-error">
          <h2>항목을 못 불러왔어</h2>
          <p>{error ?? "서버 상태를 확인해줘."}</p>
          <button type="button" onClick={() => void load(scope)}>다시 시도</button>
        </section>
      )}

      {isQuiet && (
        <section className="quiet-card warm" data-testid="items-quiet">
          <span className="quiet-dot" aria-hidden="true" />
          <h2>{scope === "active" ? "진행 중인 항목은 조용해" : "아직 항목이 없어"}</h2>
          <p>새 일정이나 할 일을 넣으면 여기서 바로 찾을 수 있어.</p>
          <a className="items-create-link" href="/input">입력하기</a>
        </section>
      )}

      {state === "live" && data && !isQuiet && (
        <div className="items-grid" data-testid="items-live">
          <section className="items-section" aria-labelledby="items-events-title">
            <div className="items-section-head">
              <h2 id="items-events-title">일정</h2>
              <span>{data.events.length}</span>
            </div>
            {data.events.length === 0 ? (
              <p className="items-empty-line">보이는 일정이 없어.</p>
            ) : (
              <ul className="items-list" role="list">
                {data.events.map((event) => (
                  <li className="items-card" key={event.id}>
                    <div>
                      <span className="items-kind">일정</span>
                      <h3>{event.title}</h3>
                      <p>{eventMeta(event)}</p>
                    </div>
                    <div className="items-card-actions">
                      <span className="items-status">{EVENT_STATUS_LABEL[event.status ?? ""] ?? "상태 없음"}</span>
                      {event.threadId != null && <a href={`/threads/${event.threadId}`}>스레드</a>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="items-section" aria-labelledby="items-tasks-title">
            <div className="items-section-head">
              <h2 id="items-tasks-title">할 일</h2>
              <span>{data.tasks.length}</span>
            </div>
            {data.tasks.length === 0 ? (
              <p className="items-empty-line">보이는 할 일이 없어.</p>
            ) : (
              <ul className="items-list" role="list">
                {data.tasks.map((task) => (
                  <li className="items-card" key={task.id}>
                    <div>
                      <span className="items-kind">할 일</span>
                      <h3>{task.title}</h3>
                      <p>{taskMeta(task)}</p>
                    </div>
                    <div className="items-card-actions">
                      <span className="items-status">{TASK_STATUS_LABEL[task.status ?? ""] ?? "상태 없음"}</span>
                      {task.threadId != null && <a href={`/threads/${task.threadId}`}>스레드</a>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
