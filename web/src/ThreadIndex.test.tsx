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
  definitionOfDone: null, deadline: "2026-09-01", status: "active" as const, createdAt: null
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
