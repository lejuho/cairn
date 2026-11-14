import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadIndex, placeThread, startDateReached } from "./ThreadIndex.js";
import type { ThreadSummary } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_THREAD = {
  id: 1, name: "프로젝트 알파", kind: "project", goal: "목표",
  definitionOfDone: null, deadline: "2026-09-01", status: "active" as const, domain: "personal" as const, createdAt: null
};

const SUMMARY: ThreadSummary = {
  thread: BASE_THREAD,
  eventCount: 2, taskCount: 3, doneCount: 1, totalCount: 5,
  relationCounts: { incoming: 0, outgoing: 0 }
};

function mockFetch(summaries: ThreadSummary[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true, data: summaries })
  }));
}

function mockFetchError() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: false, error: { message: "서버 오류" } })
  }));
}

describe("ThreadIndex — loading", () => {
  it("shows skeleton while loading", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ThreadIndex />);
    expect(screen.getByLabelText("스레드 목록 불러오는 중")).toBeInTheDocument();
    expect(document.querySelector(".today-skel")).toBeInTheDocument();
  });
});

describe("ThreadIndex — empty", () => {
  it("shows empty state and link to /threads/new", async () => {
    mockFetch([]);
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByTestId("threads-empty")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "+ 새 스레드" })).toHaveAttribute("href", "/threads/new");
  });
});

describe("ThreadIndex — live", () => {
  it("renders summary card with link to thread detail", async () => {
    mockFetch([SUMMARY]);
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByText("프로젝트 알파")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "프로젝트 알파" })).toHaveAttribute("href", "/threads/1");
  });

  it("renders progress and deadline in meta", async () => {
    mockFetch([SUMMARY]);
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByText(/1\/5/)).toBeInTheDocument());
    expect(screen.getByText(/마감 2026-09-01/)).toBeInTheDocument();
  });
});

describe("ThreadIndex — error", () => {
  it("shows error alert and new-thread link", async () => {
    mockFetchError();
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "+ 새 스레드" })).toBeInTheDocument();
  });
});

describe("ThreadIndex — access-session", () => {
  it("renders access-session recovery when fetch returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401,
      headers: { get: () => "text/html" },
      redirected: false, url: "/api/threads",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("/cdn-cgi/access/login")
    }));
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인이 필요합니다" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "다시 로그인" })).toBeInTheDocument();
  });
});

describe("ThreadIndex — domain filter (cycle-67)", () => {
  const WORK: ThreadSummary = {
    thread: { ...BASE_THREAD, id: 2, name: "업무 스레드", domain: "work" as const },
    eventCount: 0, taskCount: 0, doneCount: 0, totalCount: 0, relationCounts: { incoming: 0, outgoing: 0 }
  };
  function recordingFetch() {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      calls.push({ url, method: opts?.method ?? "GET" });
      const isWork = url.includes("domain=work");
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: isWork ? [WORK] : [SUMMARY, WORK] }) });
    }));
    return calls;
  }

  it("renders a 3-option domain segmented control with 44px buttons and a domain chip per card", async () => {
    recordingFetch();
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByText("프로젝트 알파")).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "스레드 도메인 필터" });
    expect(group).toBeInTheDocument();
    for (const label of ["전체", "개인", "업무"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("thread-domain-1").textContent).toBe("개인");
    expect(screen.getByTestId("thread-domain-2").textContent).toBe("업무");
  });

  it("selecting 업무 refetches with ?domain=work and shows only work threads — no mutation request", async () => {
    const calls = recordingFetch();
    render(<ThreadIndex />);
    await waitFor(() => expect(screen.getByText("프로젝트 알파")).toBeInTheDocument());
    screen.getByRole("button", { name: "업무" }).click();
    await waitFor(() => expect(screen.queryByText("프로젝트 알파")).not.toBeInTheDocument());
    expect(screen.getByText("업무 스레드")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("domain=work"))).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true); // filtering never mutates
  });
});

describe("ThreadIndex — board", () => {
  const thread = (id: number, name: string, status: ThreadSummary["thread"]["status"], doneCount: number, totalCount: number): ThreadSummary => ({
    ...SUMMARY,
    thread: { ...SUMMARY.thread, id, name, status },
    doneCount,
    totalCount
  });

  it("sorts every thread into 할 일 / 진행 중 / 완료 and folds paused and dropped ones", async () => {
    mockFetch([
      thread(1, "방금 만든 스레드", "active", 0, 0),
      thread(2, "아직 손 안 댄 것", "active", 0, 4),
      thread(3, "한창 하는 중", "active", 2, 5),
      thread(4, "끝낸 것", "done", 3, 3),
      thread(5, "잠시 멈춤", "paused", 1, 2),
      thread(6, "접은 것", "dropped", 0, 1)
    ]);
    render(<ThreadIndex />);
    const todo = await screen.findByRole("region", { name: "할 일 열" });
    const names = (el: HTMLElement) => [...el.querySelectorAll(".card-title")].map((n) => n.textContent);

    // 스레드에는 "할 일" 상태가 없어서, 끝낸 항목이 하나도 없는 활성 스레드를 아직 시작 전으로 본다.
    expect(names(todo)).toEqual(["방금 만든 스레드", "아직 손 안 댄 것"]);
    expect(names(screen.getByRole("region", { name: "진행 중 열" }))).toEqual(["한창 하는 중"]);
    expect(names(screen.getByRole("region", { name: "완료 열" }))).toEqual(["끝낸 것"]);

    const folded = screen.getByText("접어둔 것 2").closest("details")!;
    expect(folded).not.toHaveAttribute("open");
    expect(names(folded)).toEqual(["잠시 멈춤", "접은 것"]);
    expect(screen.getByRole("link", { name: "한창 하는 중" })).toHaveAttribute("href", "/threads/3");
  });

  it("shows an empty column as empty rather than hiding it", async () => {
    mockFetch([thread(4, "끝낸 것", "done", 3, 3)]);
    render(<ThreadIndex />);
    const todo = await screen.findByRole("region", { name: "할 일 열" });
    expect(todo.querySelector(".kanban-cards")).toBeNull();
    expect(todo).toHaveTextContent(/^할 일0$/);
    expect(screen.queryByText(/접어둔 것/)).not.toBeInTheDocument();
  });

  it("moving a thread card changes the thread's real state", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let list = [thread(1, "새 스레드", "active", 0, 2), thread(3, "한창 하는 중", "active", 2, 5)];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        const body = JSON.parse(String(opts.body)) as { column: "todo" | "doing" | "done" };
        calls.push({ url, body });
        list = list.map((s) => (url.includes(`/threads/${s.thread.id}/`)
          ? { ...s, thread: { ...s.thread, status: body.column === "done" ? "done" : "active", startedAt: body.column === "todo" ? null : "2026-11-13T00:00:00.000Z" } }
          : s));
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: list }) });
    }));
    render(<ThreadIndex />);
    const names = (label: string) => [...screen.getByRole("region", { name: label }).querySelectorAll(".card-title")].map((n) => n.textContent);
    await waitFor(() => expect(names("할 일 열")).toEqual(["새 스레드"]));

    // 진행 중으로: 안에 끝낸 게 없어도 "시작함"으로 남는다.
    fireEvent.keyDown(screen.getByRole("button", { name: "새 스레드 옮기기" }), { key: "ArrowRight" });
    await waitFor(() => expect(names("진행 중 열")).toEqual(["새 스레드", "한창 하는 중"]));
    // 완료로: 스레드 상태가 완료가 된다.
    fireEvent.keyDown(screen.getByRole("button", { name: "새 스레드 옮기기" }), { key: "ArrowRight" });
    await waitFor(() => expect(names("완료 열")).toEqual(["새 스레드"]));
    expect(calls).toEqual([
      { url: "/api/threads/1/board", body: { column: "doing" } },
      { url: "/api/threads/1/board", body: { column: "done" } }
    ]);

    // 안에 이미 진행된 항목이 있는 스레드는 할 일로 되돌리지 않고 이유를 말해준다.
    fireEvent.keyDown(screen.getByRole("button", { name: "한창 하는 중 옮기기" }), { key: "ArrowLeft" });
    expect(await screen.findByRole("status")).toHaveTextContent("진행된 항목이 있는 스레드는 할 일로 되돌릴 수 없습니다.");
    expect(calls).toHaveLength(2);
    // 맨 끝 열에서 더 가는 건 아무 일도 하지 않는다.
    fireEvent.keyDown(screen.getByRole("button", { name: "새 스레드 옮기기" }), { key: "ArrowRight" });
    expect(calls).toHaveLength(2);
  });

  it("puts a thread in 진행 중 as soon as something inside it is under way", async () => {
    mockFetch([{ ...thread(7, "막 시작한 것", "active", 0, 3), doingCount: 1 }]);
    render(<ThreadIndex />);
    const doing = await screen.findByRole("region", { name: "진행 중 열" });
    expect(doing).toHaveTextContent("막 시작한 것");
  });
});

describe("placeThread — start date", () => {
  const base = { ...SUMMARY, doneCount: 0, doingCount: 0, thread: { ...SUMMARY.thread, status: "active" as const, startedAt: null } };

  it("stays in 할 일 until the start date, then reads as 진행 중", () => {
    expect(placeThread({ ...base, thread: { ...base.thread, startDate: null } })).toBe("todo");
    expect(placeThread({ ...base, thread: { ...base.thread, startDate: "2999-01-01" } })).toBe("todo");
    expect(placeThread({ ...base, thread: { ...base.thread, startDate: "2000-01-01" } })).toBe("doing");
    expect(startDateReached("2026-11-16", "2026-11-15")).toBe(false);
    expect(startDateReached("2026-11-16", "2026-11-16")).toBe(true);
    // 완료·중지는 시작일보다 우선한다.
    expect(placeThread({ ...base, thread: { ...base.thread, startDate: "2000-01-01", status: "done" } })).toBe("done");
    expect(placeThread({ ...base, thread: { ...base.thread, startDate: "2000-01-01", status: "paused" } })).toBe("folded");
  });
});

describe("ThreadIndex — folding the done column", () => {
  it("folds 완료 into a strip that keeps its count, and remembers the choice", async () => {
    mockFetch([{ ...SUMMARY, thread: { ...SUMMARY.thread, id: 5, name: "끝난 일", status: "done" } }]);
    const first = render(<ThreadIndex />);
    expect(await screen.findByText("끝난 일")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "완료 열 접기" }));
    expect(screen.queryByText("끝난 일")).not.toBeInTheDocument();
    const column = screen.getByRole("region", { name: "완료 열" });
    expect(column).toHaveAttribute("data-collapsed", "true");
    expect(within(column).getByLabelText("1개")).toBeInTheDocument();

    // 다시 열어도 접힌 채로 나온다.
    first.unmount();
    render(<ThreadIndex />);
    fireEvent.click(await screen.findByRole("button", { name: "완료 열 펼치기" }));
    expect(screen.getByText("끝난 일")).toBeInTheDocument();
    window.localStorage.clear();
  });
});
