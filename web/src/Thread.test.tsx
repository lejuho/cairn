import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thread } from "./Thread.js";
import type { ThreadDetail } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_THREAD = {
  id: 1,
  name: "프로젝트 알파",
  kind: "project",
  goal: "1분기 목표 달성",
  definitionOfDone: null,
  deadline: "2026-09-01",
  status: "active" as const,
  createdAt: "2026-06-17T00:00:00"
};

const BASE_EVENT = {
  id: 10,
  threadId: 1,
  title: "킥오프 미팅",
  start: "2099-06-20T10:00:00+09:00",
  end: "2099-06-20T11:00:00+09:00",
  type: null, location: null,
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

const BASE_TASK = {
  id: 20, threadId: 1, title: "자료 준비",
  estMinutes: 30, due: null, context: null,
  status: "todo" as const, optional: 0, createdAt: null
};

function mockFetch(detail: ThreadDetail) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: detail })
    })
  );
}

function mockFetchError(code = "NOT_FOUND") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: { code, message: "Thread not found" } })
    })
  );
}

describe("Thread — loading state", () => {
  it("renders skeleton before fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<Thread id={1} />);
    expect(screen.getByLabelText("스레드 불러오는 중")).toBeInTheDocument();
    expect(document.querySelector(".today-skel")).toBeInTheDocument();
  });
});

describe("Thread — error state", () => {
  it("renders error alert", async () => {
    mockFetchError();
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Thread not found")).toBeInTheDocument();
  });
});

describe("Thread — empty state", () => {
  it("renders empty state when no events or tasks", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-empty")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "아직 연결된 항목이 없어" })).toBeInTheDocument();
  });
});

describe("Thread — live state", () => {
  it("renders thread header with name, goal, deadline, progress", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "프로젝트 알파" })).toBeInTheDocument());
    expect(screen.getByText("1분기 목표 달성")).toBeInTheDocument();
    expect(screen.getByText(/마감 2026-09-01/)).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("renders event and task spine nodes", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByText("킥오프 미팅")).toBeInTheDocument());
    expect(screen.getByText("자료 준비")).toBeInTheDocument();
  });

  it("past events appear below the divider", async () => {
    const pastEvent = {
      ...BASE_EVENT,
      id: 11,
      title: "지난 미팅",
      start: "2020-01-01T10:00:00+09:00",
      end: "2020-01-01T11:00:00+09:00"
    };
    mockFetch({
      thread: BASE_THREAD,
      events: [pastEvent],
      tasks: [],
      progress: { done: 0, total: 1 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByText("지난 항목")).toBeInTheDocument());
    expect(screen.getByText("지난 미팅")).toBeInTheDocument();
  });
});
