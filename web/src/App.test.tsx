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
  it("opens the calendar as the home screen", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/calendar"));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "달력" })).toHaveAttribute("aria-current", "page");
  });

  it("sends the old /today address to the calendar", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/calendar"));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
  });
});

describe("App navigation", () => {
  it("renders nav links on the home screen", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "달력" })).toBeInTheDocument();
    // 입력 화면은 메뉴에서 뺐다 (빠른 기록·에이전트가 대신한다). 주소로는 여전히 열린다.
    expect(screen.queryByRole("link", { name: "입력" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "미정" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "파라미터" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "스레드" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "사람" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "통계" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watcher" })).toBeInTheDocument();
  });

  it("sets aria-current=page on 달력 link on the home screen", async () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);
    expect(screen.getByRole("link", { name: "달력" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "스레드" })).not.toHaveAttribute("aria-current");
  });

  it("still opens the input screen by address, with nothing in the menu marked", async () => {
    window.history.replaceState(null, "", "/input");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "달력" })).not.toHaveAttribute("aria-current");
  });

  it("renders /items and marks the item tab current", async () => {
    window.history.replaceState(null, "", "/items");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("items-quiet")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "미정" })).toHaveAttribute("aria-current", "page");
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
    expect(screen.getByRole("heading", { name: "없는 페이지입니다" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "달력" })).not.toHaveAttribute("aria-current");
  });

  it("sets aria-current=page on 사람 link when on /people/:id", async () => {
    window.history.replaceState(null, "", "/people/1");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "사람" })).toHaveAttribute("aria-current", "page");
    });
  });

  it("sets aria-current=page on 통계 link when on /mirror", async () => {
    window.history.replaceState(null, "", "/mirror");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "통계" })).toHaveAttribute("aria-current", "page");
    });
    expect(screen.getByRole("link", { name: "달력" })).not.toHaveAttribute("aria-current");
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
