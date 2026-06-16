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
  cards: []
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE })
    })
  );
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
