import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const QUIET_SURFACE = {
  date: "2026-06-16",
  now: "2026-06-16T09:00:00.000Z",
  state: "quiet",
  nextEvent: null,
  conflicts: [],
  twoMinuteTasks: [],
  watcherBubbles: [],
  needsReviewEvents: [],
  unscheduledEvents: [],
  dayEvents: [],
  cards: []
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/threads")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
  }));
}

beforeEach(() => {
  stubFetch();
});

describe("App shell", () => {
  it("redirects / to /today and renders the quiet state", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);

    expect(window.location.pathname).toBe("/today");

    await waitFor(() => {
      expect(screen.getByTestId("today-quiet")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "오늘은 조용해" })).toBeInTheDocument();
  });

  it("renders /today quiet state directly", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("새로 생기면 올려둘게. 닫고 네 일 해도 돼.")).toBeInTheDocument();
    });
  });
});

describe("App navigation", () => {
  it("renders nav on /today", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "입력" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "스레드" })).toBeInTheDocument();
  });

  it("sets aria-current=page on Today link when on /today", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "입력" })).not.toHaveAttribute("aria-current");
  });

  it("sets aria-current=page on 입력 link when on /input", async () => {
    window.history.replaceState(null, "", "/input");
    render(<App />);
    expect(screen.getByRole("link", { name: "입력" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("renders nav on /threads", async () => {
    window.history.replaceState(null, "", "/threads");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [] })
    }));
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "스레드" })).toHaveAttribute("aria-current", "page");
  });

  it("renders nav on not-found route", async () => {
    window.history.replaceState(null, "", "/unknown-path");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 없는 길이야" })).toBeInTheDocument();
  });

  it("renders nav on /threads/new", async () => {
    window.history.replaceState(null, "", "/threads/new");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [] })
    }));
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
  });

  it("renders nav on /threads/:id", async () => {
    window.history.replaceState(null, "", "/threads/42");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { thread: { id: 42, name: "t", createdAt: "2026-01-01T00:00:00+00:00", updatedAt: "2026-01-01T00:00:00+00:00" }, events: [], tasks: [], replies: [] } })
    }));
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
  });
});
