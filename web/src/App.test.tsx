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
  cards: [],
  feasibility: {
    date: "2026-06-16", now: "2026-06-16T09:00:00.000Z",
    params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
    energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" as const },
    gaps: [], continuous: null, transitionCosts: [],
    sequenceEnergy: {
      workLoadUnits: 0, transitionLoadUnits: 0, totalLoadUnits: 0, budgetUnits: 8, remainingUnits: 8,
      deficit: false, unknownTransitionCount: 0, confidence: "cold_start" as const, reasonCodes: ["sequence_work_only"]
    }
  }
};

const FEAS_SETTINGS = {
  params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
  defaults: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
  limits: {
    energyBudget:        { min: 1,   max: 16,  step: 0.5, unit: "h" },
    meetBufferMinutes:   { min: 0,   max: 120, step: 5,   unit: "min" },
    deepBufferMinutes:   { min: 0,   max: 180, step: 5,   unit: "min" },
    travelMargin:        { min: 0.5, max: 3,   step: 0.1, unit: "x" },
    maxContinuousMinutes:{ min: 60,  max: 960, step: 30,  unit: "min" }
  }
};

const EMPTY_ITEMS = {
  scope: "active",
  events: [],
  tasks: []
};

const EMPTY_DIRECTORY = { ok: true, data: { people: [] } };

const EMPTY_LEDGER = {
  range: { from: "2026-05-17", to: "2026-06-16" },
  summary: { totalChanges: 0, movedCount: 0, cancelledCount: 0, freeCount: 0, paidCount: 0, moneyTotal: 0, socialTotal: 0, effortBreakdown: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 } },
  entries: [],
  sampleStatus: "low_sample"
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/items")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: EMPTY_ITEMS }) });
    }
    if (typeof url === "string" && url.includes("/api/feasibility/params")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: FEAS_SETTINGS }) });
    }
    if (typeof url === "string" && url.includes("/api/threads")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
    }
    if (typeof url === "string" && url.includes("/api/people/directory")) {
      return Promise.resolve({ json: () => Promise.resolve(EMPTY_DIRECTORY) });
    }
    if (typeof url === "string" && url.match(/\/api\/people\/\d+\/detail/)) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } }) });
    }
    if (typeof url === "string" && url.includes("/api/mirror/ledger")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: EMPTY_LEDGER }) });
    }
    if (typeof url === "string" && url.includes("/api/mirror/patterns")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {
        range: { from: "2026-05-17", to: "2026-06-16" },
        totals: { annotations: 0, done: 0, moved: 0, cancelled: 0, late: 0, slipCount: 0 },
        weekday: [], type: [], thread: [], sampleStatus: "low_sample"
      } }) });
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
  it("renders nav links on /today", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "입력" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "항목" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "파라미터" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "스레드" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "사람" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "거울" })).toBeInTheDocument();
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

  it("renders /items and marks the item tab current", async () => {
    window.history.replaceState(null, "", "/items");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("items-quiet")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "항목" })).toHaveAttribute("aria-current", "page");
  });

  it("renders /params and marks the parameter tab current", async () => {
    window.history.replaceState(null, "", "/params");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("params-live")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "파라미터" })).toHaveAttribute("aria-current", "page");
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

  it("sets aria-current=page on 사람 link when on /people", async () => {
    window.history.replaceState(null, "", "/people");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "사람" })).toHaveAttribute("aria-current", "page");
    });
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("sets aria-current=page on 사람 link when on /people/:id", async () => {
    window.history.replaceState(null, "", "/people/1");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "사람" })).toHaveAttribute("aria-current", "page");
    });
  });

  it("sets aria-current=page on 거울 link when on /mirror", async () => {
    window.history.replaceState(null, "", "/mirror");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "거울" })).toHaveAttribute("aria-current", "page");
    });
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("renders /people quiet state when no people", async () => {
    window.history.replaceState(null, "", "/people");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("people-quiet")).toBeInTheDocument();
    });
  });

  it("renders /people/:id not-found when person missing", async () => {
    window.history.replaceState(null, "", "/people/9999");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("person-not-found")).toBeInTheDocument();
    });
  });
});
