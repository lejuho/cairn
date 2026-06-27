import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadIndex } from "./ThreadIndex.js";
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인이 필요해" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "새로 고침" })).toBeInTheDocument();
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
