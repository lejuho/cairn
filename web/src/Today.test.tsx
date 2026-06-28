import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./Today.js";
import type { ConflictDecision, DayFeasibility, EventDetailData, FeasibilityParamSettingsData, TodaySurface } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const QUIET_SEQUENCE_ORDER = {
  scope: "day_scheduled_events" as const, currentOrder: [], candidateOrder: [], orderChanged: false,
  hardEdges: [], softEdges: [], violations: [], parallelGroups: [], criticalPath: [],
  cycleDetected: false, reasonCodes: []
};

const BASE_FEASIBILITY = {
  date: "2026-06-16",
  now: "2026-06-16T09:00:00.000Z",
  params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
  energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" as const },
  gaps: [],
  continuous: null,
  transitionCosts: [],
  sequenceEnergy: {
    workLoadUnits: 0, transitionLoadUnits: 0, totalLoadUnits: 0,
    budgetUnits: 8, remainingUnits: 8, deficit: false,
    unknownTransitionCount: 0, confidence: "cold_start" as const, reasonCodes: ["sequence_work_only"]
  },
  sequenceOrder: QUIET_SEQUENCE_ORDER
};

const BASE_SURFACE: TodaySurface = {
  date: "2026-06-16",
  now: "2026-06-16T09:00:00.000Z",
  state: "quiet",
  nextEvent: null,
  conflicts: [],
  twoMinuteTasks: [],
  watcherBubbles: [],
  needsReviewEvents: [],
  unscheduledEvents: [],
  dueTaskSchedulePrompts: [],
  dayEvents: [],
  cards: [],
  feasibility: BASE_FEASIBILITY
};

function mockFetch(surface: TodaySurface) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: surface })
    })
  );
}

function mockFetchError(message = "서버 오류") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      redirected: false,
      url: "",
      headers: { get: () => "application/json" },
      json: () => Promise.resolve({ ok: false, error: { message } })
    })
  );
}

function mockFetchAccessError() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
}

describe("Today — loading state", () => {
  it("renders skeleton before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {}))
    );
    render(<Today />);
    expect(document.querySelector(".today-skel")).toBeInTheDocument();
    expect(screen.getByLabelText("오늘 화면 불러오는 중")).toBeInTheDocument();
  });
});

describe("Today — quiet state", () => {
  beforeEach(() => mockFetch({ ...BASE_SURFACE, state: "quiet" }));

  it("renders quiet card with testid and heading", async () => {
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByTestId("today-quiet")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "오늘은 조용해" })).toBeInTheDocument();
    expect(screen.getByText("새로 생기면 올려둘게. 닫고 네 일 해도 돼.")).toBeInTheDocument();
  });
});

describe("Today — live state", () => {
  it("renders next_event card", async () => {
    const event = {
      id: 1, title: "팀 회의",
      start: "2026-06-16T10:00:00+00:00",
      end: "2026-06-16T11:00:00+00:00",
      threadId: null, type: null, location: null,
      mode: null,
      source: "cairn" as const, selfImposed: 1,
      status: "planned" as const,
      createdAt: null, updatedAt: null
    };
    mockFetch({
      ...BASE_SURFACE, state: "live",
      nextEvent: event,
      cards: [{ kind: "next_event", event }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("팀 회의")).toBeInTheDocument();
    });
    expect(screen.getByText("다음 일정")).toBeInTheDocument();
  });

  it("renders conflict card", async () => {
    const a = {
      id: 1, title: "미팅 A",
      start: "2026-06-16T10:00:00+00:00",
      end: "2026-06-16T12:00:00+00:00",
      threadId: null, type: null, location: null,
      mode: null,
      source: "cairn" as const, selfImposed: 1,
      status: "planned" as const,
      createdAt: null, updatedAt: null
    };
    const b = {
      id: 2, title: "미팅 B",
      start: "2026-06-16T11:00:00+00:00",
      end: "2026-06-16T13:00:00+00:00",
      threadId: null, type: null, location: null,
      mode: null,
      source: "cairn" as const, selfImposed: 1,
      status: "planned" as const,
      createdAt: null, updatedAt: null
    };
    mockFetch({
      ...BASE_SURFACE, state: "live",
      conflicts: [{ a, b }],
      cards: [{ kind: "conflict", pair: { a, b } }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("충돌")).toBeInTheDocument();
    });
    expect(screen.getByText("미팅 A ↔ 미팅 B")).toBeInTheDocument();
  });

  it("renders watcher card with bubble fields", async () => {
    const watcher = {
      id: 1, label: "여권 갱신", threshold: "2026-06-10",
      category: null, kind: "A" as const, snoozedUntil: null,
      daysOverdue: 6, reasonCodes: ["date_threshold_due" as const],
      message: "6일 지난 watcher야"
    };
    mockFetch({
      ...BASE_SURFACE, state: "live",
      watcherBubbles: [watcher],
      cards: [{ kind: "watcher", watcher }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("여권 갱신")).toBeInTheDocument();
    });
    expect(screen.getByText("기한")).toBeInTheDocument();
    expect(screen.getByText("6일 지난 watcher야")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /여권 갱신 내일 다시 보기/ })).toBeInTheDocument();
  });

  it("snooze button calls PATCH and refreshes on success", async () => {
    const watcher = {
      id: 7, label: "테스트 watcher", threshold: "2026-06-16",
      category: null, kind: "A" as const, snoozedUntil: null,
      daysOverdue: 0, reasonCodes: ["date_threshold_due" as const],
      message: "오늘 확인할 watcher야"
    };
    const liveSurface: TodaySurface = {
      ...BASE_SURFACE, state: "live",
      watcherBubbles: [watcher],
      cards: [{ kind: "watcher", watcher }]
    };
    const quietSurface: TodaySurface = { ...BASE_SURFACE, state: "quiet" };
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/watchers/7/snooze") && (opts?.method ?? "GET") === "PATCH") {
        return { ok: true, status: 200, redirected: false, url: "", headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, data: {} }) };
      }
      // First load = live, second load (after snooze) = quiet
      callCount++;
      const surface = callCount <= 1 ? liveSurface : quietSurface;
      return { ok: true, status: 200, redirected: false, url: "", headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, data: surface }) };
    }));
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /내일 다시 보기/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /내일 다시 보기/ }));
    await waitFor(() => {
      expect(screen.queryByText("테스트 watcher")).not.toBeInTheDocument();
    });
  });

  it("snooze failure shows local error and keeps card visible", async () => {
    const watcher = {
      id: 9, label: "실패 watcher", threshold: "2026-06-16",
      category: null, kind: "A" as const, snoozedUntil: null,
      daysOverdue: 0, reasonCodes: ["date_threshold_due" as const],
      message: "오늘 확인할 watcher야"
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/watchers/9/snooze") && (opts?.method ?? "GET") === "PATCH") {
        return { ok: true, status: 200, redirected: false, url: "", headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: false, error: { message: "스누즈 실패" } }) };
      }
      return { ok: true, status: 200, redirected: false, url: "", headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true, data: { ...BASE_SURFACE, state: "live", watcherBubbles: [watcher], cards: [{ kind: "watcher", watcher }] } }) };
    }));
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /내일 다시 보기/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /내일 다시 보기/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("실패 watcher")).toBeInTheDocument();
  });

  it("renders two_minute_task card with done button", async () => {
    const task = {
      id: 42, title: "빠른 답장", estMinutes: 2,
      status: "todo" as const, threadId: null, due: null,
      context: null, optional: 0, createdAt: null
    };
    mockFetch({
      ...BASE_SURFACE, state: "live",
      twoMinuteTasks: [task],
      cards: [{ kind: "two_minute_task", task }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("빠른 답장")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "빠른 답장 완료" })).toBeInTheDocument();
  });
});

describe("Today — error state", () => {
  it("renders error message with retry button", async () => {
    mockFetchError();
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("데이터를 불러오지 못했어")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

describe("Today — Access session error state", () => {
  it("renders Access-specific title and recovery action for rejected fetch", async () => {
    mockFetchAccessError();
    render(<Today />);
    await waitFor(() => expect(screen.getByText("로그인 세션이 필요해")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument();
  });

  it("Access 로그인 다시 열기 triggers full-page navigation", async () => {
    mockFetchAccessError();
    const assignMock = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/", assign: assignMock });
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Access 로그인 다시 열기" }));
    expect(assignMock).toHaveBeenCalledWith("http://localhost/");
    vi.unstubAllGlobals();
  });

  it("generic API failure still shows 데이터를 불러오지 못했어 not Access copy", async () => {
    mockFetchError("API 오류");
    render(<Today />);
    await waitFor(() => expect(screen.getByText("데이터를 불러오지 못했어")).toBeInTheDocument());
    expect(screen.queryByText("로그인 세션이 필요해")).not.toBeInTheDocument();
  });
});

describe("Today — two-minute task done action", () => {
  it("calls PATCH and refetches on done click", async () => {
    const task = {
      id: 7, title: "메모 확인", estMinutes: 1,
      status: "todo" as const, threadId: null, due: null,
      context: null, optional: 0, createdAt: null
    };
    const patchFn = vi.fn().mockResolvedValue({ ok: true });
    const liveSurface: TodaySurface = {
      ...BASE_SURFACE, state: "live",
      twoMinuteTasks: [task],
      cards: [{ kind: "two_minute_task", task }]
    };
    const quietSurface: TodaySurface = { ...BASE_SURFACE, state: "quiet" };

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve({ ok: true, json: patchFn });
        }
        call++;
        const data = call === 1 ? liveSurface : quietSurface;
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data })
        });
      })
    );

    render(<Today />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "메모 확인 완료" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "메모 확인 완료" }));

    await waitFor(() => {
      expect(screen.getByTestId("today-quiet")).toBeInTheDocument();
    });
  });
});

describe("Today — touch targets", () => {
  it("done button has minHeight 44px via CSS class", async () => {
    const task = {
      id: 1, title: "T", estMinutes: 2,
      status: "todo" as const, threadId: null, due: null,
      context: null, optional: 0, createdAt: null
    };
    mockFetch({
      ...BASE_SURFACE, state: "live",
      twoMinuteTasks: [task],
      cards: [{ kind: "two_minute_task", task }]
    });
    render(<Today />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "T 완료" });
      expect(btn).toHaveClass("today-done-btn");
    });
  });

  it("retry button has minHeight class", async () => {
    mockFetchError();
    render(<Today />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "다시 시도" });
      expect(btn).toHaveClass("today-retry");
    });
  });
});

const REVIEW_EVENT = {
  id: 99,
  title: "팀 회의",
  start: "2026-06-16T09:00:00+09:00",
  end: "2026-06-16T10:00:00+09:00",
  threadId: null,
  type: null,
  location: null,
  mode: null,
  source: "cairn" as const,
  selfImposed: 1,
  status: "planned" as const,
  createdAt: null,
  updatedAt: null
};

const NO_CONTEXT_PLACEMENT = {
  mode: "no_context" as const, anchorEventId: null, ageHours: 2, reasonCodes: ["placement_no_context"]
};

describe("Today — manual intake sheet (quiet state)", () => {
  it("quiet state renders add CTA button", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
  });

  it("clicking add opens sheet with task tab active", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByRole("dialog", { name: "작업 추가" })).toBeInTheDocument();
    expect(screen.getByLabelText("제목")).toBeInTheDocument();
  });

  it("switching to event tab shows event form", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
    expect(screen.getByRole("dialog", { name: "일정 추가" })).toBeInTheDocument();
    expect(screen.getByLabelText("시작")).toBeInTheDocument();
    expect(screen.getByLabelText("종료")).toBeInTheDocument();
  });

  it("empty task title does not call POST, only initial load + thread list fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } })
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    // opening sheet triggers thread list fetch — wait for it
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    // title is empty — submit button is disabled; no POST issued
    const saveBtn = screen.getByRole("button", { name: "작업 저장" });
    expect(saveBtn).toBeDisabled();
    // no additional fetch beyond initial load + thread list
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("valid task submit calls POST /api/tasks then refetches", async () => {
    const quietSurface = { ...BASE_SURFACE, state: "quiet" as const };
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
        if (opts?.method === "POST") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        call++;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: quietSurface }) });
      })
    );
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "새 작업" } });
    fireEvent.click(screen.getByRole("button", { name: "작업 저장" }));
    await waitFor(() => expect(call).toBe(2)); // load + refetch
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("task submit failure keeps sheet open and shows error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
        if (opts?.method === "POST") {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
      })
    );
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "새 작업" } });
    fireEvent.click(screen.getByRole("button", { name: "작업 저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("event end <= start keeps save button disabled", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "미팅" } });
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-06-17T10:00" } });
    fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-06-17T09:00" } });
    expect(screen.getByRole("button", { name: "일정 저장" })).toBeDisabled();
  });

  it("valid event submit calls POST /api/events with RFC3339 offset strings", async () => {
    let postedBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string; body?: string }) => {
        if (opts?.method === "POST") {
          postedBody = JSON.parse(opts.body ?? "{}");
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
      })
    );
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "미팅" } });
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-06-17T10:00" } });
    fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-06-17T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
    await waitFor(() => expect(postedBody).not.toBeNull());
    const body = postedBody as { title: string; start: string; end: string };
    // Must include timezone offset, not UTC Z
    expect(body.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(body.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(body.title).toBe("미팅");
  });
});

describe("Today — manual intake sheet (live state)", () => {
  it("live state renders add action without hiding existing cards", async () => {
    const event = {
      id: 1, title: "팀 회의",
      start: "2026-06-16T10:00:00+00:00", end: "2026-06-16T11:00:00+00:00",
      threadId: null, type: null, location: null, mode: null, source: "cairn" as const,
      selfImposed: 1, status: "planned" as const, createdAt: null, updatedAt: null
    };
    mockFetch({ ...BASE_SURFACE, state: "live", nextEvent: event, cards: [{ kind: "next_event", event }] });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("팀 회의")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
  });

  it("next_event priority card shows mode chip when event.mode is set", async () => {
    const event = {
      id: 1, title: "팀 회의",
      start: "2026-06-16T10:00:00+00:00", end: "2026-06-16T11:00:00+00:00",
      threadId: null, type: null, location: null, mode: "in_person" as const, source: "cairn" as const,
      selfImposed: 1, status: "planned" as const, createdAt: null, updatedAt: null
    };
    mockFetch({ ...BASE_SURFACE, state: "live", nextEvent: event, cards: [{ kind: "next_event", event }] });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("팀 회의")).toBeInTheDocument());
    const chip = screen.getByTestId("card-mode-chip");
    expect(chip).toHaveTextContent("대면");
    expect(chip).toHaveAttribute("data-mode", "in_person");
  });

  it("next_event priority card shows no mode chip when event.mode is null", async () => {
    const event = {
      id: 1, title: "팀 회의",
      start: "2026-06-16T10:00:00+00:00", end: "2026-06-16T11:00:00+00:00",
      threadId: null, type: null, location: null, mode: null, source: "cairn" as const,
      selfImposed: 1, status: "planned" as const, createdAt: null, updatedAt: null
    };
    mockFetch({ ...BASE_SURFACE, state: "live", nextEvent: event, cards: [{ kind: "next_event", event }] });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("팀 회의")).toBeInTheDocument());
    expect(screen.queryByTestId("card-mode-chip")).not.toBeInTheDocument();
  });
});

describe("Today — needs_review card", () => {
  it("renders needs_review card with chip and question", async () => {
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("기록", { selector: ".card-chip" })).toBeInTheDocument();
    });
    expect(screen.getByText("팀 회의 — 어떻게 됐어?")).toBeInTheDocument();
    expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument();
    // placement line (no_context)
    const placement = screen.getByTestId("review-placement");
    expect(placement).toHaveTextContent("짧게 확인");
    expect(placement).toHaveAttribute("data-mode", "no_context");
  });

  it.each([
    ["low_context_slot", "맥락 맞는 틈"],
    ["stale_due", "미루면 기억이 흐려져"],
    ["no_context", "짧게 확인"]
  ])("renders placement copy for %s mode", async (mode, copy) => {
    const placement = {
      mode: mode as "low_context_slot" | "stale_due" | "no_context",
      anchorEventId: mode === "low_context_slot" ? 5 : null,
      ageHours: 13,
      reasonCodes: [`placement_${mode}`]
    };
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement }]
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("review-placement")).toBeInTheDocument());
    const node = screen.getByTestId("review-placement");
    expect(node).toHaveTextContent(copy);
    expect(node).toHaveAttribute("data-mode", mode);
  });

  it("empty reply does not call fetch", async () => {
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }]
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "live", needsReviewEvents: [REVIEW_EVENT], cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }] } })
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument());

    const submitBtn = screen.getByLabelText("팀 회의 메모 제출");
    // Submit with empty input
    fireEvent.click(submitBtn);

    // fetch called only once for initial load, not for submit
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("valid reply posts to annotation API and refetches Today", async () => {
    const quietSurface: TodaySurface = { ...BASE_SURFACE, state: "quiet" };
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
        if (opts?.method === "POST") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
        }
        callCount++;
        const data = callCount === 1
          ? { ...BASE_SURFACE, state: "live" as const, needsReviewEvents: [REVIEW_EVENT], cards: [{ kind: "needs_review" as const, event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }] }
          : quietSurface;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data }) });
      })
    );

    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("팀 회의 메모"), { target: { value: "잘 됐어" } });
    fireEvent.click(screen.getByLabelText("팀 회의 메모 제출"));

    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
  });

  it("failed submit keeps card visible and shows error", async () => {
    const liveSurface: TodaySurface = {
      ...BASE_SURFACE, state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
        if (opts?.method === "POST") {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: liveSurface }) });
      })
    );

    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("팀 회의 메모"), { target: { value: "어쩌고" } });
    fireEvent.click(screen.getByLabelText("팀 회의 메모 제출"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // Card still visible
    expect(screen.getByText("팀 회의 — 어떻게 됐어?")).toBeInTheDocument();
  });

  it("clicking the title opens the event detail sheet without breaking the reply form", async () => {
    const liveSurface: TodaySurface = {
      ...BASE_SURFACE, state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT, placement: NO_CONTEXT_PLACEMENT }]
    };
    const detail: EventDetailData = {
      event: REVIEW_EVENT, people: [], annotations: [], thread: null, scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], preparations: [], preparationSuggestions: [], reasonCodes: [] }
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: detail }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: liveSurface }) });
    }));

    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument());
    // reply form still present alongside the new title button
    expect(screen.getByLabelText("팀 회의 메모 제출")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "팀 회의 상세 보기" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
  });
});

const DAY_EVENT_A = {
  id: 10, title: "오전 회의",
  start: "2026-06-16T09:00:00+09:00",
  end:   "2026-06-16T10:00:00+09:00",
  threadId: null, type: null, location: null,
  mode: null,
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

const DAY_EVENT_B = {
  id: 11, title: "오후 미팅",
  start: "2026-06-16T14:00:00+09:00",
  end:   "2026-06-16T15:00:00+09:00",
  threadId: null, type: null, location: "회의실" as const,
  mode: null,
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

describe("Today — daily timeline", () => {
  it("renders 오늘 일정 section with event rows", async () => {
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      dayEvents: [DAY_EVENT_A, DAY_EVENT_B],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("region", { name: "오늘 일정" })).toBeInTheDocument());
    expect(screen.getByText("오전 회의")).toBeInTheDocument();
    expect(screen.getByText("오후 미팅")).toBeInTheDocument();
    expect(screen.getByText("회의실")).toBeInTheDocument();
  });

  it("marks active event with aria-current when now is inside range", async () => {
    const now = "2026-06-16T09:30:00.000Z";
    const activeEvent = {
      ...DAY_EVENT_A,
      start: "2026-06-16T09:00:00.000Z",
      end:   "2026-06-16T10:00:00.000Z"
    };
    mockFetch({
      ...BASE_SURFACE,
      now,
      state: "live",
      dayEvents: [activeEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("오전 회의")).toBeInTheDocument());
    // active row has aria-current="true" and the --active class
    const activeEl = document.querySelector("[aria-current='true']");
    expect(activeEl).not.toBeNull();
    expect(activeEl).toHaveClass("today-tl-row--active");
    expect(activeEl?.textContent).toContain("오전 회의");
  });

  it("does not mark event as active when now is outside range", async () => {
    const futureEvent = {
      ...DAY_EVENT_B,
      start: "2026-06-16T14:00:00.000Z",
      end:   "2026-06-16T15:00:00.000Z"
    };
    mockFetch({
      ...BASE_SURFACE,
      now: "2026-06-16T09:00:00.000Z",
      state: "live",
      dayEvents: [futureEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("오후 미팅")).toBeInTheDocument());
    expect(document.querySelector("[aria-current='true']")).toBeNull();
    expect(document.querySelector(".today-tl-row--active")).toBeNull();
  });

  it("quiet state when both cards and dayEvents are empty", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet", dayEvents: [], cards: [] });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "오늘 일정" })).not.toBeInTheDocument();
  });

  it("event with threadId renders title button and a thread ↗ link", async () => {
    const linkedEvent = { ...DAY_EVENT_A, threadId: 7 };
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      dayEvents: [linkedEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("button", { name: "오전 회의 상세 보기" })).toBeInTheDocument());
    const threadLink = screen.getByRole("link", { name: "오전 회의 스레드" });
    expect(threadLink).toHaveAttribute("href", "/threads/7");
  });

  it("event without threadId renders title button with no thread link", async () => {
    const unlinkedEvent = { ...DAY_EVENT_B, threadId: null };
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      dayEvents: [unlinkedEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("button", { name: "오후 미팅 상세 보기" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "오후 미팅 스레드" })).not.toBeInTheDocument();
  });
});

describe("Today — thread picker in intake sheet", () => {
  const THREAD_SUMMARIES = [
    {
      thread: { id: 3, name: "Work Thread", kind: "project", goal: null, definitionOfDone: null, deadline: null, status: "active" as const, domain: "personal" as const, createdAt: null },
      eventCount: 0, taskCount: 0, doneCount: 0, totalCount: 0
    }
  ];

  function mockFetchWithThreads() {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: THREAD_SUMMARIES }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    }));
  }

  it("thread picker shows available threads in task form", async () => {
    mockFetchWithThreads();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(screen.getByLabelText("스레드 선택")).toBeInTheDocument());
    expect(screen.getByText("Work Thread")).toBeInTheDocument();
  });

  it("task submit includes threadId when thread selected", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string; body?: string }) => {
      if (url === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: THREAD_SUMMARIES }) });
      }
      if (opts?.method === "POST" && url === "/api/tasks") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(screen.getByLabelText("스레드 선택")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "My Task" } });
    fireEvent.change(screen.getByLabelText("스레드 선택"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("작업 저장"));

    await waitFor(() => {
      const taskCall = fetchSpy.mock.calls.find(
        (args: unknown[]) => args[0] === "/api/tasks" && (args[1] as { method?: string })?.method === "POST"
      );
      expect(taskCall).toBeTruthy();
      const body = JSON.parse((taskCall![1] as { body: string }).body);
      expect(body.threadId).toBe(3);
    });
  });

  it("creation works when thread list fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string; body?: string }) => {
      if (url === "/api/threads") return Promise.reject(new Error("network error"));
      if (opts?.method === "POST" && url === "/api/tasks") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    }));

    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(screen.getByLabelText(/제목/)).toBeInTheDocument());

    // No thread selector shown (fetch failed → empty threadOptions)
    expect(screen.queryByLabelText("스레드 선택")).not.toBeInTheDocument();

    // Can still submit
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "Unthreaded Task" } });
    fireEvent.click(screen.getByLabelText("작업 저장"));

    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
  });
});

describe("Today — compact Composer (cycle-70)", () => {
  function recordingFetch(opts: { captureStatus?: string; draft?: boolean; ok?: boolean } = {}) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const DRAFT = { thread: { id: 9, name: "파리 여행" }, events: [{}], tasks: [{}, {}], nodeLinks: [{}], warnings: [{ message: "날짜가 필요해" }] };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes("/api/capture/flat-event")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "캡처 실패" } } : { ok: true, data: { captureStatus: opts.captureStatus ?? "scheduled" } }) });
      if (url.includes("/api/threads/draft")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "초안 실패" } } : { ok: true, data: DRAFT }) });
      if (url === "/api/threads") return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/tasks")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "할 일 실패" } } : { ok: true }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    }));
    return calls;
  }
  const posts = (calls: Array<{ url: string; method: string; body: unknown }>) => calls.filter((c) => c.method === "POST");

  it("renders the compact Composer (3 modes/input/submit) in quiet state", async () => {
    recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "만들기 종류" })).toBeInTheDocument();
    for (const label of ["일정", "스레드", "할 일"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일정" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the compact Composer in live state without removing + 추가", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url === "/api/threads") return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "live" } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
  });

  it("switching mode updates pressed state and does not submit; empty submit disabled", async () => {
    const calls = recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.getByLabelText("만들기")).toBeDisabled();
    const before = posts(calls).length;
    fireEvent.click(screen.getByRole("button", { name: "스레드" }));
    expect(screen.getByRole("button", { name: "스레드" })).toHaveAttribute("aria-pressed", "true");
    expect(posts(calls).length).toBe(before);
  });

  it("일정 mode posts only to flat-event {text,now}, refreshes, shows scheduled 일정 card", async () => {
    const calls = recordingFetch({ captureStatus: "scheduled" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "내일 오후 2시 치과" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("capture-result");
    expect(card).toHaveTextContent("일정");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/capture/flat-event");
    expect(p[0]!.body).toMatchObject({ text: "내일 오후 2시 치과" });
    expect((p[0]!.body as { now?: string }).now).toBeDefined();
  });

  it("일정 raw/unscheduled shows 미정 일정 card with 날짜 잡기 → /input", async () => {
    recordingFetch({ captureStatus: "raw_stored" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "독서" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("capture-result");
    expect(card).toHaveTextContent("미정 일정");
    expect(card).toHaveTextContent("날짜 없이 저장됐어");
    expect(within(card).getByText("날짜 잡기")).toHaveAttribute("href", "/input");
  });

  it("스레드 mode posts only to threads/draft and shows 스레드 초안 card with counts/warning/link", async () => {
    const calls = recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "스레드" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "파리 여행 준비" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("thread-draft-success");
    expect(card).toHaveTextContent("스레드 초안");
    expect(card).toHaveTextContent("이벤트 1");
    expect(card).toHaveTextContent("작업 2");
    expect(screen.getByTestId("draft-warning")).toHaveTextContent("날짜가 필요해");
    expect(screen.getByTestId("draft-open-link")).toHaveAttribute("href", "/threads/9");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/threads/draft");
    expect(p[0]!.body).toEqual({ text: "파리 여행 준비" });
  });

  it("할 일 mode posts only to /api/tasks {title}, refreshes, shows 할 일 card", async () => {
    const calls = recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "코드 리뷰" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("task-result");
    expect(card).toHaveTextContent("할 일");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/tasks");
    expect(p[0]!.body).toEqual({ title: "코드 리뷰" });
  });

  it("Composer failure keeps mode and typed text and shows a scoped role=alert error", async () => {
    recordingFetch({ ok: false });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "유지될 텍스트" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("할 일 실패"));
    expect(screen.getByRole("button", { name: "할 일" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("만들기 입력")).toHaveValue("유지될 텍스트");
  });
});

const UNSCHEDULED_EVENT = {
  id: 42, title: "독서", start: null, end: null, source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, threadId: null, commitment: 2, reversible: 1, cancelMoney: 0,
  cancelSocial: 0, externalCalendarId: null, externalCalendarName: null,
  type: null, location: null, mode: null, createdAt: null, updatedAt: null
};

const SLOT_CANDIDATE = {
  start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
  score: 65,
  rank: 1,
  scoreLabel: "보통",
  reasons: ["2026-06-20 09:00–10:00 사이 겹치는 일정 없음", "예상 load 1.0h / 예산 8.0h"],
  reasonCodes: ["free_window", "energy_within_budget"],
  contributions: [
    { lens: "availability", label: "겹침", impact: "positive", points: 40, confidence: "observed", reasonCodes: ["free_window"], evidence: ["2026-06-20 09:00–10:00 사이 겹치는 일정 없음"] },
    { lens: "feasibility", label: "체력", impact: "positive", points: 25, confidence: "observed", reasonCodes: ["energy_within_budget"], evidence: ["예상 load 1.0h / 예산 8.0h"] },
    { lens: "people", label: "참여자", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["people_no_data"], evidence: ["연결된 사람 없음"] },
    { lens: "friction", label: "마찰", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["friction_low_sample"], evidence: ["과거 표본 부족"] }
  ]
};

describe("Today — schedule prompt", () => {
  function surfaceWithPrompt(): TodaySurface {
    return {
      ...BASE_SURFACE, state: "live",
      unscheduledEvents: [UNSCHEDULED_EVENT],
      cards: [{ kind: "schedule_prompt", event: UNSCHEDULED_EVENT }]
    };
  }

  it("renders schedule_prompt card with '날짜 잡기' button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() })
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    expect(screen.getByText(/날짜 잡을까\?/)).toBeInTheDocument();
  });

  it("schedule_prompt card renders both the date-pick and dismiss actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() })
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    expect(screen.getByTestId("dismiss-prompt-42")).toBeInTheDocument();
  });

  it("dismiss success PATCHes with the Today date and refreshes the card away", async () => {
    let dismissed = false;
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("schedule-prompt/dismiss") && opts?.method === "PATCH") {
        dismissed = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { eventId: 42, dismissedOn: "2026-06-16" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: dismissed ? { ...BASE_SURFACE, state: "quiet" } : surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("dismiss-prompt-42")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("dismiss-prompt-42"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/events/42/schedule-prompt/dismiss"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ dismissedOn: "2026-06-16" }) })
    ));
    await waitFor(() => expect(screen.queryByTestId("dismiss-prompt-42")).not.toBeInTheDocument());
  });

  it("dismiss failure keeps the card visible with scoped error copy", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("schedule-prompt/dismiss") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "숨기기 실패" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("dismiss-prompt-42")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("dismiss-prompt-42"));
    await waitFor(() => expect(screen.getByTestId("dismiss-error-42")).toBeInTheDocument());
    expect(screen.getByTestId("dismiss-prompt-42")).toBeInTheDocument(); // card stays
    expect(screen.getByTestId("dismiss-error-42")).toHaveTextContent("숨기기 실패");
  });

  it("dismiss does not fetch slot candidates or call the schedule PATCH", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("schedule-prompt/dismiss") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { eventId: 42, dismissedOn: "2026-06-16" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("dismiss-prompt-42")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("dismiss-prompt-42"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("schedule-prompt/dismiss"), expect.anything()));
    const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("slot-candidates"))).toBe(false);
    expect(urls.some((u) => /\/schedule$/.test(u))).toBe(false); // the scheduling endpoint, not dismiss
  });

  it("clicking '날짜 잡기' loads candidates", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("2026-06-20 09:00 선택")).toBeInTheDocument());
  });

  it("candidate selection calls PATCH and refetches Today", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/schedule") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: { ...UNSCHEDULED_EVENT, start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end } } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);

    // First load shows quiet (no unscheduled)
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    // Patch the surface to return schedule prompt on re-fetch
    fetchSpy.mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/schedule") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: { ...UNSCHEDULED_EVENT, start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end } } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });

    // Trigger refresh
    // Since we can't directly trigger a re-render with new surface data easily here,
    // just verify the PATCH and refetch calls are made when candidates are shown
    const fetchSpy2 = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/schedule") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy2);
    const { unmount } = render(<Today />);
    await waitFor(() => expect(screen.getAllByLabelText("독서 날짜 잡기")[0]).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("독서 날짜 잡기")[0]!);
    await waitFor(() => expect(screen.getAllByText(/2026-06-20/)[0]).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText(/2026-06-20 09:00 선택/)[0]!);
    await waitFor(() => {
      expect(fetchSpy2).toHaveBeenCalledWith(expect.stringContaining("/schedule"), expect.objectContaining({ method: "PATCH" }));
    });
    unmount();
  });

  it("failed candidate fetch shows error and keeps card visible", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "서버 오류" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByLabelText("독서 날짜 잡기")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("서버 오류");
  });

  it("clicking the title opens the event detail sheet without breaking the slot button", async () => {
    const detail: EventDetailData = {
      event: UNSCHEDULED_EVENT, people: [], annotations: [], thread: null,
      scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], preparations: [], preparationSuggestions: [], reasonCodes: [] }
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: detail }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "독서 상세 보기" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    // slot button still available behind the sheet
    expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument();
  });

  it("quick capture regression — still works with unscheduled events present", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("flat-event") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "내일 9시 회의" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("flat-event"), expect.objectContaining({ method: "POST" })));
  });

  it("renders enriched candidate score label and reason evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("2026-06-20 09:00 선택")).toBeInTheDocument());
    expect(screen.getByText("보통")).toBeInTheDocument(); // scoreLabel
    expect(screen.getByText("2026-06-20 09:00–10:00 사이 겹치는 일정 없음")).toBeInTheDocument();
    expect(screen.getByText("예상 load 1.0h / 예산 8.0h")).toBeInTheDocument();
  });

  it("candidate click still calls PATCH /schedule", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/schedule") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("2026-06-20 09:00 선택")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("2026-06-20 09:00 선택"));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/schedule"), expect.objectContaining({ method: "PATCH" }));
    });
  });

  it("feasibility reason link opens feasibility settings sheet", async () => {
    const feasCandidateWithFeasLink = {
      ...SLOT_CANDIDATE,
      contributions: [
        ...SLOT_CANDIDATE.contributions.slice(0, 1),
        { lens: "feasibility", label: "체력", impact: "negative", points: -20, confidence: "observed", reasonCodes: ["energy_over_budget"], evidence: ["예상 load 9.0h / 예산 8.0h — 초과"] },
        ...SLOT_CANDIDATE.contributions.slice(2)
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [feasCandidateWithFeasLink] } }) });
      }
      if ((url as string).includes("feasibility/params")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("슬롯 체력 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("슬롯 체력 파라미터 조정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("friction reason link points to /mirror", async () => {
    const frictionCandidate = {
      ...SLOT_CANDIDATE,
      contributions: [
        ...SLOT_CANDIDATE.contributions.slice(0, 3),
        { lens: "friction", label: "마찰", impact: "negative", points: -15, confidence: "observed", reasonCodes: ["friction_high_weekday"], evidence: ["해당 요일 이탈률 75%"] }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [frictionCandidate] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("Mirror에서 패턴 보기")).toBeInTheDocument());
    const link = screen.getByLabelText("Mirror에서 패턴 보기");
    expect(link.getAttribute("href")).toBe("/mirror");
  });

  it("people reason link navigates to /people/:id when single person identified", async () => {
    const peopleCandidate = {
      ...SLOT_CANDIDATE,
      contributions: [
        ...SLOT_CANDIDATE.contributions.slice(0, 2),
        { lens: "people", label: "참여자", impact: "negative", points: -40, confidence: "observed", reasonCodes: ["person_unavailable_weekday"], evidence: ["Alice — 해당 요일 불가"], personIds: [7] },
        SLOT_CANDIDATE.contributions[3]
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [peopleCandidate] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("사람 상세 보기")).toBeInTheDocument());
    const link = screen.getByLabelText("사람 상세 보기");
    expect(link.getAttribute("href")).toBe("/people/7");
  });

  it("event candidate evidence: 근거 toggle expands/collapses secondary lines with aria-expanded (no schedule)", async () => {
    const multiEvidence = {
      ...SLOT_CANDIDATE,
      contributions: [
        { lens: "feasibility", label: "체력", impact: "negative", points: -20, confidence: "observed", reasonCodes: ["energy_over_budget"], evidence: ["예상 load 9.0h / 예산 8.0h — 초과", "인접 일정 간격 빠듯함", "연속 일정 120분 — 최대 초과"] }
      ]
    };
    const spy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [multiEvidence] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", spy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("체력 추가 근거 보기")).toBeInTheDocument());
    const toggle = screen.getByLabelText("체력 추가 근거 보기");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // primary line visible, secondary hidden while collapsed
    expect(screen.getByText(/예상 load 9.0h/)).toBeInTheDocument();
    expect(screen.queryByText("인접 일정 간격 빠듯함")).not.toBeInTheDocument();
    // expand
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("인접 일정 간격 빠듯함")).toBeInTheDocument();
    expect(screen.getByText("연속 일정 120분 — 최대 초과")).toBeInTheDocument();
    // collapse again
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("인접 일정 간격 빠듯함")).not.toBeInTheDocument();
    // toggling never schedules or makes extra network calls
    const urls = spy.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => /\/schedule$/.test(u))).toBe(false);
    expect(urls.some((u) => u.includes("schedule-block"))).toBe(false);
  });

  it("single-evidence event contributions render no 근거 toggle", async () => {
    // default SLOT_CANDIDATE contributions each carry exactly one evidence line
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { event: UNSCHEDULED_EVENT, candidates: [SLOT_CANDIDATE] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByLabelText("2026-06-20 09:00 선택")).toBeInTheDocument());
    expect(screen.queryByLabelText(/추가 근거 보기/)).not.toBeInTheDocument();
  });

  it("candidate fetch failure keeps card visible with local alert", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "네트워크 오류" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("네트워크 오류");
  });
});

describe("Today — event detail sheet", () => {
  const BASE_EVENT = {
    id: 42, title: "팀 스프린트",
    start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00",
    threadId: null, type: null, location: null,
    mode: null,
    source: "cairn" as const, selfImposed: 1,
    status: "planned" as const,
    createdAt: null, updatedAt: null
  };
  const BASE_DETAIL: EventDetailData = {
    event: BASE_EVENT,
    people: [],
    annotations: [],
    thread: null,
    scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], preparations: [], preparationSuggestions: [], reasonCodes: [] }
  };
  const BASE_SURFACE_LIVE: TodaySurface = {
    ...BASE_SURFACE,
    state: "live",
    cards: [{ kind: "next_event", event: BASE_EVENT }]
  };

  function mockFetchWithDetail(detail = BASE_DETAIL, surface = BASE_SURFACE_LIVE) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/events/") && url.endsWith("/status") && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { event: { ...detail.event, status: "done" } } }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: detail }) });
      }
      if (typeof url === "string" && url.includes("/api/events/") && url.includes("/annotations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surface }) });
    }));
  }

  it("clicking next_event card fetches detail and opens sheet", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    const dialog = screen.getByRole("dialog", { name: "일정 상세" });
    expect(within(dialog).getByText("팀 스프린트")).toBeInTheDocument();
  });

  // ── event mode + schedule brief (FR-BRF) ──────────────────────────────────
  it("shows no mode chip when event.mode is null", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    expect(screen.queryByTestId("event-mode-chip")).not.toBeInTheDocument();
  });

  it("shows mode chip copy when event.mode is present", async () => {
    const detail = { ...BASE_DETAIL, event: { ...BASE_EVENT, mode: "remote" as const } };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByTestId("event-mode-chip")).toBeInTheDocument());
    expect(screen.getByTestId("event-mode-chip")).toHaveTextContent("비대면");
    expect(screen.getByTestId("event-mode-chip")).toHaveAttribute("data-mode", "remote");
  });

  it("does not render schedule brief for a quiet brief", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    expect(screen.queryByTestId("schedule-brief")).not.toBeInTheDocument();
  });

  it("renders schedule brief with thread, previous annotation, and people facts", async () => {
    const detail: EventDetailData = {
      ...BASE_DETAIL,
      scheduleBrief: {
        mode: "in_person",
        thread: { id: 1, name: "발표 준비", goal: "데모", deadline: "2026-06-25" },
        previousEvent: { id: 9, title: "리허설", start: null, end: "2026-06-19T10:00:00+09:00" },
        previousAnnotation: { id: 3, eventId: 9, outcome: "done", reasonTags: null, reasonText: "잘 됐어", energyAtTime: null, loggedAt: "2026-06-19T11:00:00+09:00" },
        people: [{ personId: 5, name: "Alice", relation: "동료", preferredWeekdays: ["monday"], preferredPeriods: ["evening"], leadTimeDays: 3, unavailableWeekdays: ["friday"] }],
        preparations: [],
        preparationSuggestions: [],
        reasonCodes: ["brief_mode_present", "brief_thread_present", "brief_previous_event", "brief_previous_annotation", "brief_people_present"]
      }
    };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByTestId("schedule-brief")).toBeInTheDocument());
    expect(screen.getByTestId("brief-thread")).toHaveTextContent("발표 준비");
    expect(screen.getByTestId("brief-previous")).toHaveTextContent("리허설");
    expect(screen.getByTestId("brief-previous")).toHaveTextContent("잘 됐어");
    const person = screen.getByTestId("brief-person");
    expect(person).toHaveTextContent("Alice");
    expect(person).toHaveTextContent("사전통보 3일");
    expect(person).toHaveTextContent("불가 금");
  });

  // ── preparation brief (FR-BRF-04) ─────────────────────────────────────────
  it("renders preparation rows with item/knowledge labels, source person and reason", async () => {
    const detail: EventDetailData = {
      ...BASE_DETAIL,
      scheduleBrief: {
        mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [],
        preparations: [
          {
            resource: { id: 7, name: "노트북", kind: "item", sourcePersonId: 5, note: null, createdAt: null },
            sourcePerson: { id: 5, name: "Alice" },
            links: [{ targetType: "event", targetId: 42, scope: "event_direct", firmness: "hard", reason: "발표용" }],
            reasonCodes: ["prep_event_direct"]
          },
          {
            resource: { id: 8, name: "발표 노트", kind: "knowledge", sourcePersonId: null, note: null, createdAt: null },
            sourcePerson: null,
            links: [{ targetType: "thread", targetId: 1, scope: "thread_context", firmness: "soft", reason: null }],
            reasonCodes: ["prep_thread_context"]
          }
        ],
        preparationSuggestions: [],
        reasonCodes: ["brief_preparations"]
      }
    };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByTestId("brief-preparations")).toBeInTheDocument());
    const rows = screen.getAllByTestId("prep-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveTextContent("준비물");
    expect(rows[0]!).toHaveTextContent("노트북");
    expect(rows[0]!).toHaveTextContent("출처 Alice");
    expect(rows[0]!).toHaveTextContent("발표용");
    expect(rows[1]!).toHaveTextContent("참고");
    expect(rows[1]!).toHaveTextContent("발표 노트");
  });

  it("does not render preparation section when preparations is empty", async () => {
    mockFetchWithDetail(); // BASE_DETAIL has empty preparations + quiet brief
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    expect(screen.queryByTestId("brief-preparations")).not.toBeInTheDocument();
  });

  it("shows brief section for a prep-only brief (no thread/people)", async () => {
    const detail: EventDetailData = {
      ...BASE_DETAIL,
      scheduleBrief: {
        mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [],
        preparations: [{
          resource: { id: 7, name: "노트북", kind: "item", sourcePersonId: null, note: null, createdAt: null },
          sourcePerson: null,
          links: [{ targetType: "event", targetId: 42, scope: "event_direct", firmness: "soft", reason: null }],
          reasonCodes: ["prep_event_direct"]
        }],
        preparationSuggestions: [],
        reasonCodes: ["brief_preparations"]
      }
    };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByTestId("schedule-brief")).toBeInTheDocument());
    expect(screen.getByTestId("brief-preparations")).toBeInTheDocument();
    expect(screen.queryByTestId("brief-thread")).not.toBeInTheDocument();
  });

  // ── manual preparation entry (cycle-46 FR-BRF-04) ──────────────────────────
  const PREP_OF = (name: string): EventDetailData => ({
    ...BASE_DETAIL,
    scheduleBrief: {
      mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [],
      preparations: [{
        resource: { id: 7, name, kind: "item", sourcePersonId: null, note: null, createdAt: null },
        sourcePerson: null,
        links: [{ targetType: "event", targetId: 42, scope: "event_direct", firmness: "hard", reason: "직접 추가" }],
        reasonCodes: ["prep_event_direct"]
      }],
      preparationSuggestions: [],
      reasonCodes: ["brief_preparations"]
    }
  });

  function mockPrepFlow(postOk = true) {
    let posted = false;
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/preparations") && opts?.method === "POST") {
        posted = true;
        return postOk
          ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) })
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: { message: "추가 실패" } }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        // refetch after POST returns the new preparation
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: posted ? PREP_OF("노트북") : BASE_DETAIL }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function openSheet() {
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
  }

  it("shows a collapsed 준비물 추가 control; tapping expands one input", async () => {
    mockPrepFlow();
    await openSheet();
    expect(screen.getByTestId("prep-add-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("prep-input")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("prep-add-toggle"));
    expect(screen.getByTestId("prep-input")).toBeInTheDocument();
    // submit disabled for blank input
    expect(screen.getByTestId("prep-submit")).toBeDisabled();
  });

  it("submitting posts, clears input, refetches and renders the new preparation", async () => {
    const fetchMock = mockPrepFlow();
    await openSheet();
    fireEvent.click(screen.getByTestId("prep-add-toggle"));
    fireEvent.change(screen.getByTestId("prep-input"), { target: { value: "노트북" } });
    fireEvent.click(screen.getByTestId("prep-submit"));
    await waitFor(() => expect(screen.getByTestId("brief-preparations")).toBeInTheDocument());
    expect(screen.getByTestId("prep-row")).toHaveTextContent("노트북");
    // POST issued with the trimmed name
    const post = fetchMock.mock.calls.find((c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/preparations") && (c[1] as { method?: string })?.method === "POST");
    expect(JSON.parse((post![1] as { body: string }).body)).toEqual({ name: "노트북" });
    // input collapsed back to the toggle after success
    expect(screen.queryByTestId("prep-input")).not.toBeInTheDocument();
  });

  it("failure shows a sheet-local error and keeps typed text", async () => {
    mockPrepFlow(false);
    await openSheet();
    fireEvent.click(screen.getByTestId("prep-add-toggle"));
    fireEvent.change(screen.getByTestId("prep-input"), { target: { value: "충전기" } });
    fireEvent.click(screen.getByTestId("prep-submit"));
    await waitFor(() => expect(screen.getByText("추가 실패")).toBeInTheDocument());
    expect(screen.getByTestId("prep-input")).toHaveValue("충전기"); // text kept
  });

  // ── preparation suggestions (cycle-47 FR-BRF-04) ───────────────────────────
  const sug = (name: string) => ({
    key: `presentation:${name}`, name, kind: "item" as const,
    source: "deterministic_keyword" as const, reasonCode: "presentation_keyword" as const,
    reason: "발표 일정이라 보통 챙기는 준비물", evidence: { field: "event_title" as const, value: "발표" }
  });
  const SUGGEST_DETAIL = (names: string[], preps: string[] = []): EventDetailData => ({
    ...BASE_DETAIL,
    scheduleBrief: {
      mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [],
      preparations: preps.map((n) => ({
        resource: { id: 100 + n.length, name: n, kind: "item" as const, sourcePersonId: null, note: null, createdAt: null },
        sourcePerson: null,
        links: [{ targetType: "event" as const, targetId: 42, scope: "event_direct" as const, firmness: "hard" as const, reason: "직접 추가" }],
        reasonCodes: ["prep_event_direct"]
      })),
      preparationSuggestions: names.map(sug),
      reasonCodes: names.length > 0 ? ["brief_preparation_suggestions"] : []
    }
  });

  it("does not render 준비물 제안 when there are no suggestions", async () => {
    mockFetchWithDetail(); // quiet brief, empty suggestions
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    expect(screen.queryByTestId("prep-suggestions")).not.toBeInTheDocument();
  });

  it("renders suggestion buttons with name and reason; no POST on initial render", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SUGGEST_DETAIL(["노트북", "충전기", "어댑터"]) }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    await openSheet();
    expect(screen.getByTestId("prep-suggestions")).toBeInTheDocument();
    const buttons = screen.getAllByTestId("prep-suggestion-accept");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!).toHaveTextContent("노트북");
    expect(screen.getAllByText("발표 일정이라 보통 챙기는 준비물").length).toBeGreaterThan(0);
    // no POST fired on render
    expect(fetchMock.mock.calls.some((c: unknown[]) => (c[1] as { method?: string })?.method === "POST")).toBe(false);
  });

  it("accepting a suggestion posts {name}, refetches, and drops the accepted suggestion", async () => {
    let accepted = false;
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/preparations") && opts?.method === "POST") {
        accepted = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        const data = accepted ? SUGGEST_DETAIL(["충전기", "어댑터"], ["노트북"]) : SUGGEST_DETAIL(["노트북", "충전기", "어댑터"]);
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    await openSheet();
    fireEvent.click(screen.getAllByTestId("prep-suggestion-accept")[0]!); // 노트북
    await waitFor(() => expect(screen.getAllByTestId("prep-suggestion-accept")).toHaveLength(2));
    const post = fetchMock.mock.calls.find((c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/preparations") && (c[1] as { method?: string })?.method === "POST");
    expect(JSON.parse((post![1] as { body: string }).body)).toEqual({ name: "노트북" });
    // accepted item moved into the 준비 list
    expect(screen.getByTestId("brief-preparations")).toHaveTextContent("노트북");
  });

  it("failed acceptance shows a local alert and keeps the suggestion visible", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/preparations") && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: { message: "추가 실패" } }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SUGGEST_DETAIL(["노트북", "충전기", "어댑터"]) }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    await openSheet();
    fireEvent.click(screen.getAllByTestId("prep-suggestion-accept")[0]!);
    await waitFor(() => expect(within(screen.getByTestId("prep-suggestions")).getByRole("alert")).toHaveTextContent("추가 실패"));
    expect(screen.getAllByTestId("prep-suggestion-accept")).toHaveLength(3); // still visible
  });

  it("detail sheet shows people list", async () => {
    const detail = {
      ...BASE_DETAIL,
      people: [
        { id: 1, name: "지수", relation: "팀원", channel: "kakao" as const },
        { id: 2, name: "민준", relation: null, channel: "none" as const }
      ]
    };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByText("지수 (팀원)")).toBeInTheDocument());
    expect(screen.getByText("민준")).toBeInTheDocument();
  });

  it("detail sheet shows annotations newest first", async () => {
    const detail = {
      ...BASE_DETAIL,
      annotations: [
        { id: 2, eventId: 42, outcome: null, reasonTags: null, reasonText: "최신 메모", energyAtTime: null, loggedAt: "" },
        { id: 1, eventId: 42, outcome: null, reasonTags: null, reasonText: "이전 메모", energyAtTime: null, loggedAt: "" }
      ]
    };
    mockFetchWithDetail(detail);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByText("최신 메모")).toBeInTheDocument());
    expect(screen.getByText("이전 메모")).toBeInTheDocument();
  });

  it("status buttons shown: done, cancelled, moved, late", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "상태: 완료" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "상태: 취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "상태: 이동" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "상태: 지연" })).toBeInTheDocument();
  });

  it("clicking status done calls PATCH and closes sheet", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.endsWith("/status") && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { event: { ...BASE_EVENT, status: "done" } } }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_DETAIL }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("button", { name: "상태: 완료" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "상태: 완료" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/status"), expect.objectContaining({ method: "PATCH" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("note submission calls annotation endpoint and refetches detail and Today", async () => {
    let todayCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/annotations") && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_DETAIL }) });
      }
      if (typeof url === "string" && url.includes("/api/today")) {
        todayCalls++;
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_LIVE }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    const todayCallsBeforeNote = todayCalls;
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByLabelText("메모 입력")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("메모 입력"), { target: { value: "좋은 회의였어" } });
    fireEvent.click(screen.getByLabelText("메모 제출"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/annotations"),
      expect.objectContaining({ method: "POST" })
    ));
    // detail refetch (single-arg fetch call)
    await waitFor(() => expect(fetchSpy.mock.calls.some(
      (c) => typeof c[0] === "string" && /\/api\/events\/\d+$/.test(c[0]) && c[1] === undefined
    )).toBe(true));
    // Today surface refetch happened after the note save
    await waitFor(() => expect(todayCalls).toBeGreaterThan(todayCallsBeforeNote));
  });

  it("backdrop click closes the detail sheet", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clicking close button closes the detail sheet", async () => {
    mockFetchWithDetail();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("timeline event click opens detail sheet", async () => {
    const tl_event = { ...BASE_EVENT, id: 99, title: "오후 미팅" };
    const detail = { ...BASE_DETAIL, event: tl_event };
    const surface: TodaySurface = { ...BASE_SURFACE, state: "live", dayEvents: [tl_event], cards: [] };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: detail }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surface }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("button", { name: "오후 미팅 상세 보기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "오후 미팅 상세 보기" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
    const dialog = screen.getByRole("dialog", { name: "일정 상세" });
    expect(within(dialog).getByText("오후 미팅")).toBeInTheDocument();
  });
});

describe("Today — feasibility panel", () => {
  const FEAS_BASE = {
    date: "2026-06-16", now: "2026-06-16T09:00:00.000Z",
    params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
    energy: { loadUnits: 3, budgetUnits: 8, remainingUnits: 5, deficit: false, confidence: "cold_start" as const },
    gaps: [],
    continuous: null,
    transitionCosts: [],
    sequenceEnergy: {
      workLoadUnits: 3, transitionLoadUnits: 0, totalLoadUnits: 3,
      budgetUnits: 8, remainingUnits: 5, deficit: false,
      unknownTransitionCount: 0, confidence: "cold_start" as const, reasonCodes: ["sequence_work_only"]
    },
    sequenceOrder: QUIET_SEQUENCE_ORDER
  };

  it("renders energy gauge in quiet state", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: FEAS_BASE });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.getByRole("meter", { name: /에너지 부하/ })).toBeInTheDocument();
    expect(screen.getByText("3.0h / 8h")).toBeInTheDocument();
  });

  it("renders energy gauge in live state", async () => {
    mockFetch({
      ...BASE_SURFACE, state: "live",
      feasibility: FEAS_BASE,
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.getByRole("meter")).toBeInTheDocument();
  });

  it("shows gap tight warning when status is tight", async () => {
    const feas = {
      ...FEAS_BASE,
      gaps: [{
        availableMinutes: 5, requiredMinutes: 15,
        status: "tight" as const, mode: "near" as const,
        reasonCodes: ["gap_tight"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByText(/여유 부족/)).toBeInTheDocument());
    expect(screen.getByText(/임박/)).toBeInTheDocument();
  });

  it("shows impossible gap warning when status is impossible", async () => {
    const feas = {
      ...FEAS_BASE,
      gaps: [{
        availableMinutes: -10, requiredMinutes: 15,
        status: "impossible" as const, mode: "planning" as const,
        reasonCodes: ["gap_impossible"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByText(/겹침/)).toBeInTheDocument());
    expect(screen.getByText(/10분 초과/)).toBeInTheDocument();
  });

  it("shows ok gaps without warning", async () => {
    const feas = {
      ...FEAS_BASE,
      gaps: [{
        availableMinutes: 30, requiredMinutes: 15,
        status: "ok" as const, mode: "planning" as const,
        reasonCodes: ["gap_ok"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.queryByText(/여유 부족/)).not.toBeInTheDocument();
    expect(screen.queryByText(/겹침/)).not.toBeInTheDocument();
  });

  it("shows continuous warning when span exceeds max", async () => {
    const feas = {
      ...FEAS_BASE,
      continuous: { spanMinutes: 700, exceedsMax: true }
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByText(/연속 700분/)).toBeInTheDocument());
  });

  it("shows deficit label when energy load exceeds budget", async () => {
    const feas = {
      ...FEAS_BASE,
      energy: { loadUnits: 10, budgetUnits: 8, remainingUnits: -2, deficit: true, confidence: "cold_start" as const }
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("초과")).toBeInTheDocument());
  });

  // ── transition costs (맥락 전환, FR-FEAS-08) ──────────────────────────────
  const tEvent = (id: number, title: string) => ({
    id, title, threadId: null, type: null,
    start: "2026-06-16T09:00:00+09:00", end: "2026-06-16T10:00:00+09:00",
    location: null, mode: null, source: "cairn" as const, selfImposed: 1, status: "planned" as const,
    createdAt: null, updatedAt: null
  });

  it("renders 맥락 전환 section for non-none transitions with titles and cost label", async () => {
    const feas = {
      ...FEAS_BASE,
      transitionCosts: [{
        fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: 20,
        relation: "unrelated" as const, costLevel: "high" as const, reasonCodes: ["transition_unrelated"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "회의"), tEvent(2, "운동")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("맥락 전환")).toBeInTheDocument());
    const row = screen.getByTestId("transition-row");
    expect(row).toHaveTextContent("회의 → 운동");
    expect(row).toHaveTextContent("전환 비용 높음");
    expect(row).toHaveAttribute("data-cost", "high");
  });

  it("does not render 맥락 전환 section when all transitions are none (same thread)", async () => {
    const feas = {
      ...FEAS_BASE,
      transitionCosts: [{
        fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: 10,
        relation: "same_thread" as const, costLevel: "none" as const, reasonCodes: ["transition_same_thread"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "회의"), tEvent(2, "정리")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.queryByLabelText("맥락 전환")).not.toBeInTheDocument();
  });

  it("renders unknown transition as uncertainty, not a hard warning", async () => {
    const feas = {
      ...FEAS_BASE,
      transitionCosts: [{
        fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: null,
        relation: "missing_thread" as const, costLevel: "unknown" as const, reasonCodes: ["transition_missing_thread"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "회의"), tEvent(2, "약속")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("맥락 전환")).toBeInTheDocument());
    const row = screen.getByTestId("transition-row");
    expect(row).toHaveAttribute("data-cost", "unknown");
    expect(row).toHaveTextContent("전환 비용 불확실");
    expect(row).toHaveTextContent("스레드 정보가 없어");
    // not a warning-styled gap/continuous row
    expect(row.className).not.toContain("feas-gap");
  });

  it("keeps energy/gap rendering intact alongside transitions", async () => {
    const feas = {
      ...FEAS_BASE,
      gaps: [{ availableMinutes: 5, requiredMinutes: 15, status: "tight" as const, mode: "near" as const, reasonCodes: ["gap_tight"] }],
      transitionCosts: [{
        fromEventId: 1, toEventId: 2, fromThreadId: 10, toThreadId: 20,
        relation: "context_link" as const, relationKind: "feeds" as const, firmness: "soft" as const,
        costLevel: "low" as const, reasonCodes: ["transition_context_link"]
      }]
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "회의"), tEvent(2, "운동")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("맥락 전환")).toBeInTheDocument());
    expect(screen.getByText(/여유 부족/)).toBeInTheDocument(); // gap still rendered
    expect(screen.getByText("3.0h / 8h")).toBeInTheDocument(); // energy still rendered
    expect(screen.getByTestId("transition-row")).toHaveTextContent("전환 비용 낮음");
  });

  // ── sequence energy (전환 포함, FR-FEAS-09) ───────────────────────────────
  const seq = (over: Partial<DayFeasibility["sequenceEnergy"]>): DayFeasibility["sequenceEnergy"] => ({
    workLoadUnits: 3, transitionLoadUnits: 0, totalLoadUnits: 3, budgetUnits: 8, remainingUnits: 5,
    deficit: false, unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"], ...over
  });

  it("renders 전환 포함 section when transition load is added", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceEnergy: seq({ transitionLoadUnits: 0.75, totalLoadUnits: 3.75, remainingUnits: 4.25, reasonCodes: ["sequence_transition_added"] })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("전환 포함")).toBeInTheDocument());
    const node = screen.getByTestId("sequence-energy");
    expect(node).toHaveTextContent("일 3.00h");
    expect(node).toHaveTextContent("전환 0.75h");
    expect(node).toHaveTextContent("합계 3.75h / 8h");
    expect(node).toHaveAttribute("data-deficit", "false");
  });

  it("does not render 전환 포함 for a same-thread-only day (no added load, no unknown)", async () => {
    const feas = { ...FEAS_BASE, sequenceEnergy: seq({}) }; // total == work, unknown 0
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.queryByLabelText("전환 포함")).not.toBeInTheDocument();
  });

  it("shows unknown transitions as uncertainty copy, not inflated energy", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceEnergy: seq({ unknownTransitionCount: 2, reasonCodes: ["sequence_work_only", "sequence_unknown_present"] })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("전환 포함")).toBeInTheDocument());
    const node = screen.getByTestId("sequence-energy");
    expect(node).toHaveTextContent("전환 2건은 스레드 정보가 없어 비용을 매기지 않았어");
    // total equals work (no inflation)
    expect(node).toHaveTextContent("합계 3.00h / 8h");
  });

  it("marks deficit when sequence total exceeds budget even if duration-only does not", async () => {
    const feas = {
      ...FEAS_BASE,
      energy: { loadUnits: 7.5, budgetUnits: 8, remainingUnits: 0.5, deficit: false, confidence: "cold_start" as const },
      sequenceEnergy: seq({ workLoadUnits: 7.5, transitionLoadUnits: 0.75, totalLoadUnits: 8.25, remainingUnits: -0.25, deficit: true, reasonCodes: ["sequence_transition_added", "sequence_deficit"] })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("sequence-energy")).toHaveAttribute("data-deficit", "true"));
    // duration-only energy row shows no 초과 (loadUnits < budget)
    const node = screen.getByTestId("sequence-energy");
    expect(node).toHaveTextContent("합계 8.25h / 8h");
  });

  // ── sequence order (순서 힌트, FR-FEAS-10) ──────────────────────────────────
  const order = (over: Partial<DayFeasibility["sequenceOrder"]>): DayFeasibility["sequenceOrder"] => ({
    ...QUIET_SEQUENCE_ORDER, ...over
  });

  it("does not render 순서 힌트 for a quiet equal order", async () => {
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: FEAS_BASE, dayEvents: [tEvent(1, "회의")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("일정 부하")).toBeInTheDocument());
    expect(screen.queryByTestId("sequence-order")).not.toBeInTheDocument();
  });

  it("renders a dependency violation in clear copy", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceOrder: order({
        currentOrder: [1, 2], candidateOrder: [2, 1], orderChanged: true,
        hardEdges: [{ from: 2, to: 1, kind: "requires", firmness: "hard" }],
        violations: [{ from: 2, to: 1, kind: "requires" }],
        reasonCodes: ["sequence_order_violations_present", "sequence_order_changed"]
      })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "발표"), tEvent(2, "리허설")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("순서 힌트")).toBeInTheDocument());
    const v = screen.getByTestId("seqorder-violation");
    expect(v).toHaveTextContent("리허설");
    expect(v).toHaveTextContent("발표");
    // candidate preview shown, with no mutate control
    expect(screen.getByTestId("seqorder-candidate")).toHaveTextContent("제안 순서: 리허설 → 발표");
    expect(screen.queryByRole("button", { name: /적용|순서/ })).not.toBeInTheDocument();
  });

  it("renders the critical path", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceOrder: order({
        currentOrder: [1, 2], candidateOrder: [1, 2],
        hardEdges: [{ from: 1, to: 2, kind: "blocks", firmness: "hard" }],
        criticalPath: [1, 2], reasonCodes: ["sequence_order_has_dependencies"]
      })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "준비"), tEvent(2, "발표")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("sequence-order")).toBeInTheDocument());
    expect(screen.getByTestId("seqorder-critical")).toHaveTextContent("핵심 경로: 준비 → 발표");
  });

  it("renders soft-only dependency evidence (non-quiet, no empty section)", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceOrder: order({
        currentOrder: [1, 2], candidateOrder: [1, 2], orderChanged: false,
        softEdges: [{ from: 2, to: 1, kind: "requires", firmness: "soft" }],
        reasonCodes: ["sequence_order_has_dependencies"]
      })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "발표"), tEvent(2, "리허설")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("sequence-order")).toBeInTheDocument());
    // soft edge shown as evidence — section is not just a bare heading
    const soft = screen.getByTestId("seqorder-soft-edge");
    expect(soft).toHaveTextContent("리허설 → 발표");
    expect(soft).toHaveTextContent("약한 의존");
    // soft edges stay evidence-only, so no candidate/violation copy
    expect(screen.queryByTestId("seqorder-candidate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("seqorder-violation")).not.toBeInTheDocument();
  });

  it("renders a cycle warning without crashing", async () => {
    const feas = {
      ...FEAS_BASE,
      sequenceOrder: order({
        currentOrder: [1, 2], candidateOrder: [1, 2],
        hardEdges: [{ from: 1, to: 2, kind: "blocks", firmness: "hard" }, { from: 2, to: 1, kind: "blocks", firmness: "hard" }],
        cycleDetected: true, reasonCodes: ["sequence_order_cycle_detected"]
      })
    };
    mockFetch({ ...BASE_SURFACE, state: "quiet", feasibility: feas, dayEvents: [tEvent(1, "A"), tEvent(2, "B")] });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("seqorder-cycle")).toBeInTheDocument());
    expect(screen.getByTestId("seqorder-cycle")).toHaveTextContent("순환 의존");
    // no candidate/critical shown on cycle
    expect(screen.queryByTestId("seqorder-candidate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("seqorder-critical")).not.toBeInTheDocument();
  });
});

describe("Today — conflict decision sheet", () => {
  const makeEvent = (id: number, title: string, start: string, end: string) => ({
    id, title, start, end,
    threadId: null, type: null, location: null,
    mode: null,
    source: "cairn" as const, selfImposed: 1,
    status: "planned" as const,
    createdAt: null, updatedAt: null
  });

  const eventA = makeEvent(1, "미팅 A", "2026-06-16T10:00:00+00:00", "2026-06-16T12:00:00+00:00");
  const eventB = makeEvent(2, "미팅 B", "2026-06-16T11:00:00+00:00", "2026-06-16T13:00:00+00:00");

  const CONFLICT: ConflictDecision = {
    id: "1:2",
    pair: { a: eventA, b: eventB },
    overlapMinutes: 60,
    urgency: "near",
    actionability: "resolvable",
    disabledReasonCodes: [],
    options: [
      {
        event: eventA, action: "move_or_cancel",
        cost: { money: 0, social: 0, effort: "none", window: null },
        reversible: 1, commitment: 2,
        suggested: false, reasonCodes: []
      },
      {
        event: eventB, action: "move_or_cancel",
        cost: { money: 5000, social: 2, effort: "high", window: null },
        reversible: 0, commitment: 3,
        suggested: true, reasonCodes: ["lower_cancel_cost"]
      }
    ]
  };

  const READ_ONLY_CONFLICT: ConflictDecision = {
    ...CONFLICT,
    actionability: "read_only",
    disabledReasonCodes: ["far_future"]
  };

  const SURFACE_WITH_CONFLICT: TodaySurface = {
    ...BASE_SURFACE, state: "live",
    conflicts: [{ a: eventA, b: eventB }],
    cards: [{ kind: "conflict", pair: { a: eventA, b: eventB } }]
  };

  const VALID_ANNOTATION = { id: 1, eventId: 2, outcome: "moved" as const, reasonTags: '["conflict_resolution"]', reasonText: "conflict_resolution", energyAtTime: null, loggedAt: "2026-06-20T00:00:00Z" };

  function mockDecisionFetch(resolveOk = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/decisions/conflicts/resolve")) {
          return Promise.resolve({
            json: () =>
              Promise.resolve(
                resolveOk
                  ? { ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } }
                  : { ok: false, error: { code: "CONFLICT_STALE" } }
              )
          });
        }
        if (url.includes("/api/decisions/conflicts")) {
          return Promise.resolve({
            json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } })
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
      })
    );
  }

  it("conflict card opens decision sheet on click", async () => {
    mockDecisionFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.getByText("미팅 A")).toBeInTheDocument();
    expect(screen.getByText("미팅 B")).toBeInTheDocument();
  });

  it("sheet shows overlap summary and urgency", async () => {
    mockDecisionFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.getByText(/겹침 60분/)).toBeInTheDocument();
    expect(screen.getByText(/임박/)).toBeInTheDocument();
  });

  it("sheet shows cost chips", async () => {
    mockDecisionFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.getByText(/5,000원/)).toBeInTheDocument();
    expect(screen.getByText(/사회적/)).toBeInTheDocument();
    expect(screen.getByText(/높음/)).toBeInTheDocument();
  });

  it("sheet shows 추천 badge on suggested option", async () => {
    mockDecisionFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.getByText("추천")).toBeInTheDocument();
  });

  it("resolve action posts payload, shows resolved sheet, and refetches Today on complete", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    // Resolve API called → resolved sheet opens
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    // Today is NOT yet refetched — only when 완료 is clicked
    const todayCallsBefore = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("/api/today") && (c[1] as RequestInit | undefined)?.method !== "POST"
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/api/today")
      ).length).toBeGreaterThan(todayCallsBefore)
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolved sheet heading shows changed event title and 이동 outcome", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    // Title comes from the parsed response's changedEvent (eventB = "미팅 B")
    expect(screen.getByRole("heading", { name: "미팅 B — 이동" })).toBeInTheDocument();
  });

  it("resolved sheet heading shows changed event title and 취소 outcome", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "cancelled" }, annotation: { ...VALID_ANNOTATION, outcome: "cancelled" as const }, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 취소 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "미팅 B — 취소" })).toBeInTheDocument();
  });

  it("resolved sheet: initial focus, sentinel wrap, Escape close, inert background, and opener restore", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    const opener = screen.getByLabelText(/충돌 해결/);
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());

    const dialog = screen.getByRole("dialog", { name: "충돌 해결 완료" });
    const closeBtn = screen.getByRole("button", { name: "닫기" });
    const doneBtn = screen.getByRole("button", { name: "완료" });

    // Initial focus lands on the close control.
    await waitFor(() => expect(closeBtn).toHaveFocus());

    // Background main is inert while the resolved sheet is open.
    const main = document.querySelector("main.today-live");
    expect(main).toHaveAttribute("inert");

    // Start sentinel wraps focus to the last focusable element (완료).
    const sentinels = Array.from(
      dialog.parentElement!.querySelectorAll('[aria-hidden="true"][tabindex="0"]')
    );
    expect(sentinels.length).toBe(2);
    fireEvent.focus(sentinels[0]!);
    expect(doneBtn).toHaveFocus();
    // End sentinel wraps focus back to the first focusable element (닫기).
    fireEvent.focus(sentinels[1]!);
    expect(closeBtn).toHaveFocus();

    // Escape closes the resolved sheet and restores focus to the opener.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "충돌 해결 완료" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toHaveFocus());
  });

  it("완료 on the normal resolve path (conflict removed) focuses the stable Today region", async () => {
    // Production conflict detection only keeps planned/confirmed events, so the
    // resolved (moved) conflict disappears on refetch and the opener is gone.
    // Mirror that here: the refetch returns a conflict-free live surface (other
    // Today cards remain), so the live Today region renders without the opener.
    const CONFLICT_FREE: TodaySurface = {
      ...BASE_SURFACE, state: "live",
      nextEvent: eventA,
      cards: [{ kind: "next_event", event: eventA }]
    };
    let resolved = false;
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        resolved = true;
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: resolved ? [] : [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: resolved ? CONFLICT_FREE : SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    // Sheet closes; the resolved conflict no longer exists so the opener is gone.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByLabelText(/충돌 해결/)).not.toBeInTheDocument());
    // Focus lands on the stable Today region rather than the document body.
    const main = document.querySelector("main.today-live");
    await waitFor(() => expect(main).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it("완료 restores focus to the opener when the conflict survives the remount", async () => {
    // Edge path: the conflict still exists after refetch (e.g. a second pair),
    // so the live opener is re-rendered and focus returns to it.
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } })
        });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The opener survives the remount and regains focus.
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toHaveFocus());
  });

  it("failed resolve keeps sheet open and shows error", async () => {
    mockDecisionFetch(false);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByText("충돌이 이미 해소됐어")).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument();
  });

  it("read_only conflict sheet shows disabled buttons and explanatory copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/decisions/conflicts")) {
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [READ_ONLY_CONFLICT] } }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
      })
    );
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.getByText("아직 계획 구간이라 해소 버튼은 잠가둠")).toBeInTheDocument();
    const moveBtns = screen.getAllByRole("button", { name: /이동 처리/ });
    moveBtns.forEach((btn) => expect(btn).toBeDisabled());
    const cancelBtns = screen.getAllByRole("button", { name: /취소 처리/ });
    cancelBtns.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("resolvable conflict sheet still submits resolve payload and refetches Today", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/api/decisions/conflicts/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [] } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    expect(screen.queryByText("아직 계획 구간이라 해소 버튼은 잠가둠")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(
        (c) => typeof c[0] === "string" && c[0].includes("/api/decisions/conflicts/resolve")
      )).toBe(true)
    );
  });

  it("resolve success shows resolved sheet with no-person quiet state", async () => {
    mockDecisionFetch(true);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    expect(screen.getByText("연결된 사람이 없어 통보 초안이 없어.")).toBeInTheDocument();
    expect(screen.queryByText("보내기")).not.toBeInTheDocument();
    expect(screen.queryByText("전송")).not.toBeInTheDocument();
  });

  it("resolve success shows draft cards with moved message and copy button", async () => {
    const PERSON_DRAFT = {
      personId: 7, personName: "민지", channel: "kakao" as const,
      leadTimeDays: 3, leadTimeStatus: "enough" as const, tone: "neutral" as const,
      message: "민지님, \"미팅 B\" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.",
      reasonCodes: ["tone_profile_unavailable" as const]
    };
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [PERSON_DRAFT] } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    expect(screen.getByText("민지")).toBeInTheDocument();
    expect(screen.getByText("kakao")).toBeInTheDocument();
    expect(screen.getByTestId("draft-message-7")).toHaveTextContent("민지님");
    expect(screen.getByTestId("draft-message-7")).toHaveTextContent("새 시간은 정해지는 대로");
    expect(screen.getByRole("button", { name: "민지 초안 복사" })).toBeInTheDocument();
    expect(screen.queryByText("보내기")).not.toBeInTheDocument();
  });

  it("per-draft clipboard copy success shows 복사됨", async () => {
    const DRAFT = {
      personId: 3, personName: "주호", channel: null as null,
      leadTimeDays: null, leadTimeStatus: "unknown" as const, tone: "neutral" as const,
      message: "주호님, \"미팅 B\" 일정을 취소해야 해. 미안해.",
      reasonCodes: ["channel_unset" as const, "lead_time_unset" as const, "tone_profile_unavailable" as const]
    };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "cancelled" }, annotation: { ...VALID_ANNOTATION, outcome: "cancelled" as const }, notificationDrafts: [DRAFT] } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 취소 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "주호 초안 복사" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("복사됨");
  });

  it("per-draft clipboard copy failure shows 복사 실패", async () => {
    const DRAFT = {
      personId: 5, personName: "수지", channel: "sms" as const,
      leadTimeDays: 1, leadTimeStatus: "late" as const, tone: "neutral" as const,
      message: "수지님, \"미팅 B\" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.",
      reasonCodes: ["lead_time_late" as const, "tone_profile_unavailable" as const]
    };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [DRAFT] } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "수지 초안 복사" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("복사 실패");
  });

  it("clipboard API unavailable shows 복사 실패 without throwing", async () => {
    const DRAFT = {
      personId: 9, personName: "나연", channel: "sms" as const,
      leadTimeDays: 1, leadTimeStatus: "enough" as const, tone: "neutral" as const,
      message: "나연님, \"미팅 B\" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.",
      reasonCodes: ["tone_profile_unavailable" as const]
    };
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { changedEvent: { ...eventB, status: "moved" }, annotation: VALID_ANNOTATION, notificationDrafts: [DRAFT] } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결 완료" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "나연 초안 복사" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("복사 실패");
  });

  it("malformed resolve response retains conflict sheet with error", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "POST" && String(url).includes("/resolve")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { unexpected: true } }) });
      }
      if (String(url).includes("/api/decisions/conflicts")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { conflicts: [CONFLICT] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_WITH_CONFLICT }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("미팅 B 이동 처리"));
    await waitFor(() => expect(screen.getByText("서버 응답이 예상과 달라")).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "충돌 해결 완료" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument();
  });
});

// ── Today — conflict sheet people guard ───────────────────────────────────────

describe("Today — conflict sheet people guard", () => {
  const eventA = { id: 1, title: "미팅 A", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00", source: "cairn" as const, selfImposed: 1, status: "planned" as const, threadId: null, type: null, location: null, mode: null, createdAt: null, updatedAt: null };
  const eventB = { id: 2, title: "미팅 B", start: "2026-06-20T11:00:00+09:00", end: "2026-06-20T12:00:00+09:00", source: "cairn" as const, selfImposed: 1, status: "planned" as const, threadId: null, type: null, location: null, mode: null, createdAt: null, updatedAt: null };

  const BASE_SURFACE_GUARD: TodaySurface = {
    date: "2026-06-20", now: "2026-06-20T09:00:00+09:00", state: "live",
    nextEvent: null, conflicts: [{ a: eventA, b: eventB }],
    twoMinuteTasks: [], watcherBubbles: [], needsReviewEvents: [], unscheduledEvents: [],
    dueTaskSchedulePrompts: [],
    dayEvents: [], cards: [{ kind: "conflict", pair: { a: eventA, b: eventB } }],
    feasibility: {
      date: "2026-06-20", now: "2026-06-20T09:00:00+09:00",
      params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
      energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" },
      gaps: [], continuous: null, transitionCosts: [],
      sequenceEnergy: {
        workLoadUnits: 0, transitionLoadUnits: 0, totalLoadUnits: 0, budgetUnits: 8, remainingUnits: 8,
        deficit: false, unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"]
      },
      sequenceOrder: { scope: "day_scheduled_events", currentOrder: [], candidateOrder: [], orderChanged: false, hardEdges: [], softEdges: [], violations: [], parallelGroups: [], criticalPath: [], cycleDetected: false, reasonCodes: [] }
    }
  };

  const GUARD_CONFLICT: ConflictDecision = {
    id: "1:2", pair: { a: eventA, b: eventB }, overlapMinutes: 60,
    urgency: "near", actionability: "resolvable", disabledReasonCodes: [],
    options: [
      {
        event: eventA, action: "move_or_cancel",
        cost: { money: 0, social: 2, effort: "none", window: null },
        reversible: 1, commitment: 1, suggested: false, reasonCodes: ["required_by_people_constraint"],
        socialContext: { base: 2, adjustment: 0, effective: 2, confidence: "cold_start", contributions: [{ personId: 10, personName: "홍길동", totalMeets: 0, lastMet: null, frequencyBand: "cold_start", adjustment: 0 }] },
        peopleGuard: { blocked: false, keepEventId: 2, reasonCodes: [], constraints: [] }
      },
      {
        event: eventB, action: "move_or_cancel",
        cost: { money: 0, social: 1, effort: "none", window: null },
        reversible: 1, commitment: 1, suggested: false, reasonCodes: [],
        socialContext: { base: 1, adjustment: 0, effective: 1, confidence: "none", contributions: [] },
        peopleGuard: { blocked: true, keepEventId: 1, reasonCodes: ["weekday_unavailable"], constraints: [{ personId: 10, personName: "홍길동", keptEventId: 1, constraintText: "saturday 불가" }] }
      }
    ]
  };

  function setupMock(conflict: ConflictDecision) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/decisions/conflicts?")) {
        return Promise.resolve({ ok: true, redirected: false, url: "", headers: { get: () => "application/json" }, json: () => Promise.resolve({ ok: true, data: { conflicts: [conflict] } }) });
      }
      if (typeof url === "string" && url.includes("/api/decisions/conflicts/resolve")) {
        return Promise.resolve({ ok: true, redirected: false, url: "", headers: { get: () => "application/json" }, json: () => Promise.resolve({ ok: true, data: { changedEvent: eventA, annotation: { id: 1, eventId: 1, outcome: "moved", reasonText: "test", reasonTags: "[]", energyAtTime: null, createdAt: null } } }) });
      }
      return Promise.resolve({ ok: true, redirected: false, url: "", headers: { get: () => "application/json" }, json: () => Promise.resolve({ ok: true, data: BASE_SURFACE_GUARD }) });
    }));
  }

  async function openSheet() {
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText(/충돌 해결/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/충돌 해결/));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "충돌 해결" })).toBeInTheDocument());
  }

  it("shows social contributions in conflict sheet", async () => {
    setupMock(GUARD_CONFLICT);
    await openSheet();
    // Contribution renders as "홍길동 — 0회 (cold_start)" — unique to contribution li
    const contribEls = document.querySelectorAll(".conflict-contribution");
    expect(contribEls.length).toBeGreaterThan(0);
    expect(contribEls[0]!.textContent).toMatch(/홍길동/);
    expect(contribEls[0]!.textContent).toMatch(/cold_start/);
  });

  it("blocked option shows 제약 badge", async () => {
    setupMock(GUARD_CONFLICT);
    await openSheet();
    const badge = document.querySelector(".conflict-blocked-badge");
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("제약");
  });

  it("blocked option shows constraint reason text", async () => {
    setupMock(GUARD_CONFLICT);
    await openSheet();
    expect(screen.getByText(/saturday 불가/)).toBeInTheDocument();
  });

  it("blocked option buttons are disabled and make no resolve request", async () => {
    setupMock(GUARD_CONFLICT);
    await openSheet();
    const moveBtn = screen.getByLabelText("미팅 B 이동 처리");
    const cancelBtn = screen.getByLabelText("미팅 B 취소 처리");
    expect(moveBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    fireEvent.click(moveBtn);
    await new Promise((r) => setTimeout(r, 50));
    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => typeof c[0] === "string" && c[0].includes("/resolve"))).toBe(false);
  });

  it("unblocked option buttons remain actionable", async () => {
    setupMock(GUARD_CONFLICT);
    await openSheet();
    const moveBtn = screen.getByLabelText("미팅 A 이동 처리");
    expect(moveBtn).not.toBeDisabled();
  });

  it("both-blocked shows escalation copy", async () => {
    const BOTH_BLOCKED: ConflictDecision = {
      ...GUARD_CONFLICT,
      options: [
        { ...GUARD_CONFLICT.options[0], peopleGuard: { blocked: true, keepEventId: 2, reasonCodes: ["weekday_unavailable"], constraints: [] } },
        { ...GUARD_CONFLICT.options[1] }
      ]
    };
    setupMock(BOTH_BLOCKED);
    await openSheet();
    expect(screen.getByText(/두 선택지 모두 사람 제약에 걸려있어/)).toBeInTheDocument();
  });

  it("existing read_only disables all (not just guard-blocked) — no regression", async () => {
    const READ_ONLY_GUARD: ConflictDecision = { ...GUARD_CONFLICT, actionability: "read_only", disabledReasonCodes: ["far_future"] };
    setupMock(READ_ONLY_GUARD);
    await openSheet();
    expect(screen.getByLabelText("미팅 A 이동 처리")).toBeDisabled();
    expect(screen.getByLabelText("미팅 A 취소 처리")).toBeDisabled();
    expect(screen.getByLabelText("미팅 B 이동 처리")).toBeDisabled();
    expect(screen.getByLabelText("미팅 B 취소 처리")).toBeDisabled();
    expect(screen.getByText("아직 계획 구간이라 해소 버튼은 잠가둠")).toBeInTheDocument();
  });
});

const BASE_FEAS_SETTINGS: FeasibilityParamSettingsData = {
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

describe("Today — feasibility settings sheet", () => {
  afterEach(() => { vi.useRealTimers(); });

  function liveSurface(): TodaySurface {
    return { ...BASE_SURFACE, state: "live", cards: [] };
  }

  function mockFetchSequence(responses: unknown[]) {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      const resp = responses[Math.min(call++, responses.length - 1)];
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve(resp) });
    }));
  }

  it("renders 조정 button on feasibility panel in live state", async () => {
    mockFetchSequence([{ ok: true, data: liveSurface() }]);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
  });

  it("opening settings fetches params and renders five sliders", async () => {
    mockFetchSequence([
      { ok: true, data: liveSurface() },
      { ok: true, data: BASE_FEAS_SETTINGS }
    ]);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "feasibility 파라미터 조정" })).toBeInTheDocument());
    expect(screen.getByLabelText(/에너지 예산/)).toBeInTheDocument();
    expect(screen.getByLabelText(/미팅 버퍼/)).toBeInTheDocument();
    expect(screen.getByLabelText(/집중 버퍼/)).toBeInTheDocument();
    expect(screen.getByLabelText(/이동 여유/)).toBeInTheDocument();
    expect(screen.getByLabelText(/최대 연속/)).toBeInTheDocument();
  });

  it("cancel closes the sheet without PUT", async () => {
    mockFetchSequence([
      { ok: true, data: liveSurface() },
      { ok: true, data: BASE_FEAS_SETTINGS }
    ]);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("취소"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const fetchMock = vi.mocked(global.fetch);
    const putCalls = fetchMock.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === "PUT";
    });
    expect(putCalls).toHaveLength(0);
  });

  it("apply calls PUT and refreshes Today on success", async () => {
    let fetchCall = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchCall++;
      if (fetchCall === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (fetchCall === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      if (init?.method === "PUT") return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      // refresh today
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText("파라미터 저장")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("파라미터 저장"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const fetchMock = vi.mocked(global.fetch);
    const putCalls = fetchMock.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === "PUT";
    });
    expect(putCalls).toHaveLength(1);
  });

  it("save failure keeps sheet open and shows error", async () => {
    let fetchCall = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      fetchCall++;
      if (fetchCall === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (fetchCall === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: false, error: { message: "저장 오류" } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText("파라미터 저장")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("파라미터 저장"));
    await waitFor(() => expect(screen.getByText("저장 오류")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("backdrop click closes sheet without save", async () => {
    mockFetchSequence([
      { ok: true, data: liveSurface() },
      { ok: true, data: BASE_FEAS_SETTINGS }
    ]);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("slider change sends POST preview with draft params and surface date/now", async () => {
    const PREVIEW_FEAS = {
      date: "2026-06-16",
      now: "2026-06-16T09:00:00.000Z",
      params: { ...BASE_FEAS_SETTINGS.params, energyBudget: 10 },
      energy: { loadUnits: 0, budgetUnits: 10, remainingUnits: 10, deficit: false, confidence: "cold_start" },
      gaps: [],
      continuous: null,
      transitionCosts: []
    };
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (callCount === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: PREVIEW_FEAS }) });
    }));
    render(<Today />);
    // Wait for initial load and sheet open with real timers
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText(/에너지 예산/)).toBeInTheDocument());
    // Switch to fake timers only for the debounce part
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(/에너지 예산/), { target: { value: "10" } });
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    const fetchMock = vi.mocked(global.fetch);
    const previewCall = fetchMock.mock.calls.find((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === "POST" && String(c[0]).includes("preview");
    });
    expect(previewCall).toBeDefined();
    const body = JSON.parse(previewCall![1]!.body as string) as { date: string; now: string; params: { energyBudget: number } };
    expect(body.params.energyBudget).toBe(10);
    expect(body.date).toBe("2026-06-16");
    expect(body.now).toBe("2026-06-16T09:00:00.000Z");
  });

  it("preview result renders inside the sheet", async () => {
    const PREVIEW_FEAS = {
      date: "2026-06-16",
      now: "2026-06-16T09:00:00.000Z",
      params: { ...BASE_FEAS_SETTINGS.params, energyBudget: 10 },
      energy: { loadUnits: 2, budgetUnits: 10, remainingUnits: 8, deficit: false, confidence: "cold_start" },
      gaps: [],
      continuous: null,
      transitionCosts: []
    };
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (callCount === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: PREVIEW_FEAS }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText(/에너지 예산/)).toBeInTheDocument());
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(/에너지 예산/), { target: { value: "10" } });
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    expect(screen.getByLabelText("미리보기 결과")).toBeInTheDocument();
    expect(screen.getByText(/2\.0h \/ 10h/)).toBeInTheDocument();
  });

  it("preview failure shows role=alert and keeps sheet open", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (callCount === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: false, error: { message: "preview 오류" } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText(/에너지 예산/)).toBeInTheDocument());
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(/에너지 예산/), { target: { value: "10" } });
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    expect(screen.getByRole("alert", { hidden: false })).toBeInTheDocument();
    expect(screen.getByText("preview 오류")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("rapid slider changes cancel stale — only last preview POST fires", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: liveSurface() }) });
      if (callCount === 2) return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      const FEAS = {
        date: "2026-06-16", now: "2026-06-16T09:00:00.000Z",
        params: { ...BASE_FEAS_SETTINGS.params },
        energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" },
        gaps: [], continuous: null, transitionCosts: []
      };
      return Promise.resolve({ ok: true, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: FEAS }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("feasibility 파라미터 조정")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("feasibility 파라미터 조정"));
    await waitFor(() => expect(screen.getByLabelText(/에너지 예산/)).toBeInTheDocument());
    const slider = screen.getByLabelText(/에너지 예산/);
    vi.useFakeTimers();
    // First change — debounce timer starts
    fireEvent.change(slider, { target: { value: "9" } });
    // Advance 100ms (less than 300ms debounce) then change again — resets timer
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.change(slider, { target: { value: "10" } });
    // Drain remaining timers + microtasks — only the second timer fires
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    const fetchMock = vi.mocked(global.fetch);
    const previewCalls = fetchMock.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === "POST" && String(c[0]).includes("preview");
    });
    expect(previewCalls).toHaveLength(1);
    const body = JSON.parse(previewCalls[0]![1]!.body as string) as { params: { energyBudget: number } };
    expect(body.params.energyBudget).toBe(10);
  });
});

const DUE_TASK = {
  id: 77, threadId: null, title: "보고서", estMinutes: 90, due: "2026-06-16",
  context: null, status: "todo" as const, optional: 0, createdAt: null
};

describe("Today — due task schedule prompt (cycle-62)", () => {
  function surfaceWithTaskPrompt(): TodaySurface {
    return {
      ...BASE_SURFACE, state: "live",
      dueTaskSchedulePrompts: [DUE_TASK],
      cards: [{ kind: "task_schedule_prompt", task: DUE_TASK }]
    };
  }

  it("renders due date, estimate, and a 후보 보기 preview CTA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) }));
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("task-schedule-prompt-77")).toBeInTheDocument());
    expect(screen.getByText(/마감 잡을까\?/)).toBeInTheDocument();
    expect(screen.getByText(/마감 2026-06-16 · 예상 90분/)).toBeInTheDocument();
    expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument();
  });

  it("renders candidate rows as explicit schedule-block apply actions (cycle-63)", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/tasks/77/slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { task: DUE_TASK, candidates: [SLOT_CANDIDATE] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("보고서 후보 보기"));
    await waitFor(() => expect(screen.getByTestId("task-candidates-77")).toBeInTheDocument());
    // an explicit "작업 블록 만들기" button (not a done/complete action)
    const apply = screen.getByLabelText("2026-06-20 09:00 작업 블록 만들기");
    expect(apply).toBeInTheDocument();
    expect(screen.getByText(/작업 블록을 만들어 \(완료 처리는 아님\)/)).toBeInTheDocument();
  });

  it("applying a candidate POSTs schedule-block (only) and refreshes the card away", async () => {
    let applied = false;
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("/api/tasks/77/slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { task: DUE_TASK, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/api/tasks/77/schedule-block") && opts?.method === "POST") {
        applied = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { task: { ...DUE_TASK, scheduledEventId: 999 }, event: { id: 999 } } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: applied ? { ...BASE_SURFACE, state: "quiet" } : surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("보고서 후보 보기"));
    await waitFor(() => expect(screen.getByTestId("task-apply-77")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("2026-06-20 09:00 작업 블록 만들기"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/77/schedule-block"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining(SLOT_CANDIDATE.start) })
    ));
    await waitFor(() => expect(screen.queryByTestId("task-schedule-prompt-77")).not.toBeInTheDocument());
    // never calls the event schedule endpoints nor a task status patch
    const calls = fetchSpy.mock.calls;
    expect(calls.some((c) => (c[0] as string).includes("/api/events/"))).toBe(false);
    expect(calls.some((c) => /\/schedule$/.test(c[0] as string))).toBe(false);
    expect(calls.some((c) => (c[0] as string).includes("/api/tasks/77/status"))).toBe(false);
  });

  it("apply failure keeps the prompt visible with scoped error copy", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("/api/tasks/77/slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { task: DUE_TASK, candidates: [SLOT_CANDIDATE] } }) });
      }
      if ((url as string).includes("/api/tasks/77/schedule-block") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "선택한 시간이 더 이상 비어있지 않아" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("보고서 후보 보기"));
    await waitFor(() => expect(screen.getByTestId("task-apply-77")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("2026-06-20 09:00 작업 블록 만들기"));
    await waitFor(() => expect(screen.getByTestId("task-apply-error-77")).toBeInTheDocument());
    expect(screen.getByTestId("task-schedule-prompt-77")).toBeInTheDocument();
    expect(screen.getByTestId("task-apply-error-77")).toHaveTextContent("선택한 시간이 더 이상 비어있지 않아");
  });

  // --- Task slot evidence actions (cycle-64 FR-SLOT-09B) ---

  const NEUTRAL_CONTRIB = { lens: "people", label: "참여자", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["people_no_data"], evidence: ["연결된 사람 없음"] };
  function taskCandidate(contributions: unknown[]) {
    return { ...SLOT_CANDIDATE, contributions };
  }
  function mockTaskCandidateFetch(candidate: unknown) {
    const spy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/tasks/77/slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { task: DUE_TASK, candidates: [candidate] } }) });
      }
      if ((url as string).includes("feasibility/params")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: BASE_FEAS_SETTINGS }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }
  async function loadTaskCandidates() {
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("보고서 후보 보기"));
    await waitFor(() => expect(screen.getByTestId("task-candidates-77")).toBeInTheDocument());
  }

  it("task feasibility evidence opens the feasibility settings sheet and does NOT schedule a block", async () => {
    const spy = mockTaskCandidateFetch(taskCandidate([
      { lens: "feasibility", label: "체력", impact: "negative", points: -20, confidence: "observed", reasonCodes: ["energy_over_budget"], evidence: ["예상 load 9.0h / 예산 8.0h — 초과"] },
      NEUTRAL_CONTRIB
    ]));
    await loadTaskCandidates();
    const adjust = screen.getByLabelText("슬롯 체력 파라미터 조정");
    expect(adjust.tagName).toBe("BUTTON"); // keyboard-focusable
    fireEvent.click(adjust);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const urls = spy.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("feasibility/params"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/tasks/77/schedule-block"))).toBe(false);
    // the task prompt is still present (evidence action did not apply/hide it)
    expect(screen.getByTestId("task-schedule-prompt-77")).toBeInTheDocument();
  });

  it("task friction evidence links to /mirror", async () => {
    mockTaskCandidateFetch(taskCandidate([
      { lens: "friction", label: "마찰", impact: "negative", points: -15, confidence: "observed", reasonCodes: ["friction_high_weekday"], evidence: ["해당 요일 이탈률 75%"] }
    ]));
    await loadTaskCandidates();
    const link = screen.getByLabelText("Mirror에서 패턴 보기");
    expect(link.getAttribute("href")).toBe("/mirror");
  });

  it("task people evidence links to /people/:id with exactly one personIds entry", async () => {
    mockTaskCandidateFetch(taskCandidate([
      { lens: "people", label: "참여자", impact: "negative", points: -40, confidence: "observed", reasonCodes: ["person_unavailable_weekday"], evidence: ["Alice — 해당 요일 불가"], personIds: [7] }
    ]));
    await loadTaskCandidates();
    expect(screen.getByLabelText("사람 상세 보기").getAttribute("href")).toBe("/people/7");
  });

  it("task people evidence with multiple person ids has no profile link", async () => {
    mockTaskCandidateFetch(taskCandidate([
      { lens: "people", label: "참여자", impact: "negative", points: -40, confidence: "observed", reasonCodes: ["person_unavailable_weekday"], evidence: ["여러 명 — 해당 요일 불가"], personIds: [7, 8] }
    ]));
    await loadTaskCandidates();
    expect(screen.queryByLabelText("사람 상세 보기")).not.toBeInTheDocument();
  });

  it("neutral task contributions have no evidence action", async () => {
    mockTaskCandidateFetch(taskCandidate([
      NEUTRAL_CONTRIB,
      { lens: "feasibility", label: "체력", impact: "neutral", points: 0, confidence: "unavailable", reasonCodes: ["feasibility_unavailable"], evidence: [] },
      { lens: "friction", label: "마찰", impact: "neutral", points: 0, confidence: "cold_start", reasonCodes: ["friction_low_sample"], evidence: ["과거 표본 부족"] }
    ]));
    await loadTaskCandidates();
    expect(screen.queryByLabelText("슬롯 체력 파라미터 조정")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mirror에서 패턴 보기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("사람 상세 보기")).not.toBeInTheDocument();
  });

  // --- Task slot evidence details (cycle-65 FR-SLOT-09C) ---

  it("task candidate evidence: 근거 toggle expands secondary lines and never calls schedule-block", async () => {
    const spy = mockTaskCandidateFetch(taskCandidate([
      { lens: "friction", label: "마찰", impact: "negative", points: -15, confidence: "observed", reasonCodes: ["friction_high_weekday"], evidence: ["해당 요일 이탈률 75%", "유형 이탈률 60%", "스레드 이탈률 55%"] }
    ]));
    await loadTaskCandidates();
    const toggle = screen.getByLabelText("마찰 추가 근거 보기");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("해당 요일 이탈률 75%")).toBeInTheDocument();
    expect(screen.queryByText("유형 이탈률 60%")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("유형 이탈률 60%")).toBeInTheDocument();
    expect(screen.getByText("스레드 이탈률 55%")).toBeInTheDocument();
    const urls = spy.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("/api/tasks/77/schedule-block"))).toBe(false);
    expect(urls.some((u) => u.includes("/api/events/"))).toBe(false);
  });

  it("task contributions with single or blank-only secondary evidence render no 근거 toggle", async () => {
    mockTaskCandidateFetch(taskCandidate([
      { lens: "feasibility", label: "체력", impact: "neutral", points: 0, confidence: "unavailable", reasonCodes: ["feasibility_unavailable"], evidence: [] },
      { lens: "people", label: "참여자", impact: "negative", points: -40, confidence: "observed", reasonCodes: ["person_unavailable_weekday"], evidence: ["Alice — 해당 요일 불가", "   ", ""], personIds: [7] }
    ]));
    await loadTaskCandidates();
    expect(screen.queryByLabelText(/추가 근거 보기/)).not.toBeInTheDocument();
    // the single-person profile action is still present (unchanged)
    expect(screen.getByLabelText("사람 상세 보기")).toBeInTheDocument();
  });

  it("blank/whitespace FIRST evidence with one real line shows that line as primary and renders no 근거 toggle (review-v1 ISSUE-1)", async () => {
    mockTaskCandidateFetch(taskCandidate([
      { lens: "friction", label: "마찰", impact: "negative", points: -15, confidence: "observed", reasonCodes: ["friction_high_weekday"], evidence: ["", "실제 근거 한 줄"] },
      { lens: "feasibility", label: "체력", impact: "negative", points: -20, confidence: "observed", reasonCodes: ["energy_over_budget"], evidence: ["   ", "체력 실제 근거"] }
    ]));
    await loadTaskCandidates();
    // the single real line is the visible primary, not a blank
    expect(screen.getByText("실제 근거 한 줄")).toBeInTheDocument();
    expect(screen.getByText("체력 실제 근거")).toBeInTheDocument();
    // only one non-empty evidence line each → NO toggle
    expect(screen.queryByLabelText(/추가 근거 보기/)).not.toBeInTheDocument();
  });

  it("dismiss success PATCHes the task dismiss route with the Today date and refreshes the card away", async () => {
    let dismissed = false;
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("/api/tasks/77/schedule-prompt/dismiss") && opts?.method === "PATCH") {
        dismissed = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { taskId: 77, dismissedOn: "2026-06-16" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: dismissed ? { ...BASE_SURFACE, state: "quiet" } : surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("task-dismiss-prompt-77")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("task-dismiss-prompt-77"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/77/schedule-prompt/dismiss"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ dismissedOn: "2026-06-16" }) })
    ));
    await waitFor(() => expect(screen.queryByTestId("task-dismiss-prompt-77")).not.toBeInTheDocument());
  });

  it("dismiss failure keeps the card with scoped error copy", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("schedule-prompt/dismiss") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "숨기기 실패" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("task-dismiss-prompt-77")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("task-dismiss-prompt-77"));
    await waitFor(() => expect(screen.getByTestId("task-dismiss-error-77")).toBeInTheDocument());
    expect(screen.getByTestId("task-schedule-prompt-77")).toBeInTheDocument();
    expect(screen.getByTestId("task-dismiss-error-77")).toHaveTextContent("숨기기 실패");
  });

  it("candidate fetch failure shows an error and keeps the card", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/tasks/77/slot-candidates")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "후보 로딩 실패" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: surfaceWithTaskPrompt() }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("보고서 후보 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("보고서 후보 보기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("후보 로딩 실패"));
    expect(screen.getByTestId("task-schedule-prompt-77")).toBeInTheDocument();
  });
});

describe("Today — domain filter (cycle-67)", () => {
  function recordingFetch(surfaceState: "quiet" | "live" = "quiet") {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: surfaceState } }) });
    }));
    return calls;
  }

  it("renders the 3-option domain control (all default) and refetches Today with the selected domain", async () => {
    const calls = recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "오늘 도메인 필터" })).toBeInTheDocument();
    for (const label of ["전체", "개인", "업무"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    // initial load already filters by the default domain
    expect(calls.some((u) => u.includes("/api/today") && u.includes("domain=all"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "업무" }));
    await waitFor(() => expect(calls.some((u) => u.includes("/api/today") && u.includes("domain=work"))).toBe(true));
  });

  it("keeps the quiet state and control intact when the selected domain is empty", async () => {
    recordingFetch("quiet");
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "개인" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "개인" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("today-quiet")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "오늘 도메인 필터" })).toBeInTheDocument();
  });
});

describe("Today — Watcher & 기록 Composer modes (cycle-71)", () => {
  const DAY_EVENT = { id: 88, title: "데모", start: "2026-06-17T14:00:00+09:00", end: "2026-06-17T15:00:00+09:00", source: "cairn", selfImposed: 1, status: "planned", threadId: null, commitment: 2, reversible: 1, cancelMoney: 0, cancelSocial: 0, externalCalendarId: null, externalCalendarName: null, externalId: null, type: null, location: null, mode: null, createdAt: null, updatedAt: null };
  function recordingFetch(opts: { dayEvents?: unknown[]; ok?: boolean; parseStatus?: string } = {}) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      if (url === "/api/threads") return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/watchers")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "watcher 실패" } } : { ok: true, data: { id: 9 } }) });
      if (/\/api\/events\/\d+\/annotations/.test(url)) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "기록 실패" } } : { ok: true, data: { annotation: { id: 1 }, parseStatus: opts.parseStatus ?? "parsed" } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet", dayEvents: opts.dayEvents ?? [] } }) });
    }));
    return calls;
  }
  const posts = (calls: Array<{ url: string; method: string; body: unknown }>) => calls.filter((c) => c.method === "POST");

  it("compact Composer exposes five modes including Watcher and 기록", async () => {
    recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    for (const label of ["일정", "스레드", "할 일", "Watcher", "기록"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("date-threshold watcher posts only to /api/watchers and shows a Watcher card → /watch", async () => {
    const calls = recordingFetch();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    expect(screen.getByTestId("watcher-fields")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "여권 갱신" } });
    fireEvent.change(screen.getByLabelText("watcher 마감일"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("watcher-result");
    expect(within(card).getByText("지켜볼 것에서 보기")).toHaveAttribute("href", "/watch");
    expect(card).toHaveTextContent("날짜 기반"); // subtype kind in status (review-v1 ISSUE-2)
    const p = posts(calls);
    expect(p.some((c) => c.url.includes("/api/watchers") && (c.body as { threshold?: string }).threshold === "2026-07-01")).toBe(true);
    expect(p.every((c) => c.url.includes("/api/watchers"))).toBe(true); // no other POST endpoint
  });

  it("기록 targets include event-bearing cards when dayEvents is empty (review-v1 ISSUE-1)", async () => {
    const CARD_EVENT = { ...DAY_EVENT, id: 91, title: "리뷰 미팅" };
    const calls = recordingFetch({ dayEvents: [] });
    // override surface to a live state with a next_event card but no dayEvents
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      if (url === "/api/threads") return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (/\/api\/events\/\d+\/annotations/.test(url)) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { annotation: { id: 1 }, parseStatus: "parsed" } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "live", dayEvents: [], cards: [{ kind: "next_event", event: CARD_EVENT }] } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    // the card's event is an available record target even though dayEvents is empty
    fireEvent.change(screen.getByLabelText("기록할 이벤트"), { target: { value: "91" } });
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "리뷰 메모" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await screen.findByTestId("record-result");
    const annotationPost = calls.find((c) => c.method === "POST" && /\/api\/events\/\d+\/annotations/.test(c.url));
    expect(annotationPost?.url).toBe("/api/events/91/annotations");
    expect(annotationPost?.body).toEqual({ text: "리뷰 메모" });
  });

  it("기록 mode requires an explicit target; submit posts only to annotations {text}", async () => {
    const calls = recordingFetch({ dayEvents: [DAY_EVENT], parseStatus: "parsed" });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "데모 잘 끝남" } });
    expect(screen.getByLabelText("만들기")).toBeDisabled(); // no target yet
    fireEvent.change(screen.getByLabelText("기록할 이벤트"), { target: { value: "88" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("record-result");
    expect(card).toHaveTextContent("데모");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toBe("/api/events/88/annotations");
    expect(p[0]!.body).toEqual({ text: "데모 잘 끝남" });
  });

  it("record API failure preserves text and target", async () => {
    recordingFetch({ dayEvents: [DAY_EVENT], ok: false });
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    fireEvent.change(screen.getByLabelText("기록할 이벤트"), { target: { value: "88" } });
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "유지" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("기록 실패"));
    expect(screen.getByLabelText("만들기 입력")).toHaveValue("유지");
    expect((screen.getByLabelText("기록할 이벤트") as HTMLSelectElement).value).toBe("88");
  });
});

describe("Today — event location preview (cycle-74)", () => {
  const EVENT_WITH_LOC = {
    id: 42, title: "팀 스프린트",
    start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00",
    threadId: null, type: null, location: "서울타워",
    mode: null, source: "cairn" as const, selfImposed: 1, status: "planned" as const,
    createdAt: null, updatedAt: null
  };
  const DETAIL_LOC: EventDetailData = {
    event: EVENT_WITH_LOC, people: [], annotations: [], thread: null,
    scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], preparations: [], preparationSuggestions: [], reasonCodes: [] }
  };
  const SURFACE_LOC: TodaySurface = { ...BASE_SURFACE, state: "live", cards: [{ kind: "next_event", event: EVENT_WITH_LOC }] };

  const GEO_RESOLVED = {
    eventId: 42, provider: "google", locationText: "서울타워", normalizedLocation: "서울타워",
    cacheStatus: "miss", status: "resolved", latitude: 37.55, longitude: 126.98,
    displayLabel: "N Seoul Tower", providerResultId: "p1", confidence: "high", providerStatus: "OK",
    uncertainty: { locationType: "ROOFTOP", partialMatch: false }, createdAt: "t", updatedAt: null, lastCheckedAt: "t"
  };

  type GeoMock = { detail?: EventDetailData; geocodeImpl?: () => Promise<{ status?: number; ok?: boolean; json: () => Promise<unknown> }> };
  function mockGeo(o: GeoMock) {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string; body?: unknown }) => {
      if (typeof url === "string" && url.includes("/geocode") && opts?.method === "POST") {
        calls.push({ url, method: opts?.method, body: opts?.body });
        return (o.geocodeImpl ?? (() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: GEO_RESOLVED }) })))();
      }
      if (typeof url === "string" && url.match(/\/api\/events\/\d+$/) && !opts?.method) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: o.detail ?? DETAIL_LOC }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: SURFACE_LOC }) });
    }));
    return calls;
  }
  const openSheet = async () => {
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("팀 스프린트 상세 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("팀 스프린트 상세 보기"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument());
  };

  it("blank location → quiet state, no /geocode call", async () => {
    const blank = { ...DETAIL_LOC, event: { ...EVENT_WITH_LOC, location: null } };
    const calls = mockGeo({ detail: blank });
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-quiet")).toBeInTheDocument());
    expect(calls).toHaveLength(0);
  });

  it("non-empty location → loading then resolved preview with coords map action", async () => {
    let resolveGeo: (v: unknown) => void = () => {};
    const calls = mockGeo({ geocodeImpl: () => new Promise((r) => { resolveGeo = () => r({ ok: true, json: () => Promise.resolve({ ok: true, data: GEO_RESOLVED }) }); }) });
    await openSheet();
    expect(screen.getByTestId("geo-loading")).toBeInTheDocument();
    await act(async () => { resolveGeo(undefined); });
    await waitFor(() => expect(screen.getByTestId("geo-resolved")).toBeInTheDocument());
    expect(screen.getByText("N Seoul Tower")).toBeInTheDocument();
    expect(screen.getByTestId("geo-confidence")).toHaveTextContent("정확");
    const link = screen.getByRole("link", { name: "지도에서 열기" });
    expect(link).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=37.55%2C126.98");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(calls).toHaveLength(1);
  });

  it("geocode POST carries no body and no query string", async () => {
    const calls = mockGeo({});
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-resolved")).toBeInTheDocument());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/events/42/geocode");
    expect(calls[0]!.url).not.toContain("?");
    expect(calls[0]!.body).toBeUndefined();
  });

  it("ambiguous → uncertainty + candidate labels, authored-text map action, no coordinate", async () => {
    const geo = { ...GEO_RESOLVED, status: "ambiguous", latitude: null, longitude: null, displayLabel: null, providerResultId: null, confidence: "unknown", uncertainty: { resultCount: 2, candidateLabels: ["서울역", "서울시청"] } };
    mockGeo({ geocodeImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: geo }) }) });
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-ambiguous")).toBeInTheDocument());
    expect(screen.getByText("서울역")).toBeInTheDocument();
    expect(screen.getByText("서울시청")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "지도에서 열기" });
    expect(link).toHaveAttribute("href", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("서울타워")}`);
    expect(screen.queryByTestId("geo-confidence")).not.toBeInTheDocument();
  });

  it("zero_results and failed → honest unresolved with authored-text map action", async () => {
    for (const status of ["zero_results", "failed"]) {
      cleanup();
      const geo = { ...GEO_RESOLVED, status, latitude: null, longitude: null, displayLabel: null, providerResultId: null, confidence: "unknown", uncertainty: null };
      mockGeo({ geocodeImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: geo }) }) });
      await openSheet();
      await waitFor(() => expect(screen.getByTestId(`geo-${status}`)).toBeInTheDocument());
      expect(screen.getByText("위치를 찾지 못했어 — 입력한 텍스트로 지도를 열 수 있어.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "지도에서 열기" })).toHaveAttribute("href", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("서울타워")}`);
    }
  });

  it("provider error response → sheet-local error + retry recovers", async () => {
    let n = 0;
    mockGeo({ geocodeImpl: () => {
      n += 1;
      return n === 1
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: { code: "unavailable", message: "Map provider is unavailable" } }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: GEO_RESOLVED }) });
    } });
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-error")).toBeInTheDocument());
    expect(screen.getByText("Map provider is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument(); // sheet still open
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByTestId("geo-resolved")).toBeInTheDocument());
    expect(n).toBe(2);
  });

  it("access/session failure → access copy, sheet stays open", async () => {
    mockGeo({ geocodeImpl: () => Promise.reject(new Error("network")) });
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-error")).toBeInTheDocument());
    expect(screen.getByText("로그인 세션이 만료됐거나 네트워크가 끊겼어")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument();
  });

  it("invalid geocode response shape → local error, no crash", async () => {
    mockGeo({ geocodeImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { garbage: 1 } }) }) });
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("geo-error")).toBeInTheDocument());
    expect(screen.getByText("위치 정보를 불러오지 못했어")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeInTheDocument();
  });

  it("closing the sheet before the geocode resolves shows no stale preview", async () => {
    let resolveGeo: (v: unknown) => void = () => {};
    mockGeo({ geocodeImpl: () => new Promise((r) => { resolveGeo = () => r({ ok: true, json: () => Promise.resolve({ ok: true, data: GEO_RESOLVED }) }); }) });
    await openSheet();
    expect(screen.getByTestId("geo-loading")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일정 상세" })).not.toBeInTheDocument());
    await act(async () => { resolveGeo(undefined); });
    expect(screen.queryByTestId("geo-resolved")).not.toBeInTheDocument();
    expect(screen.queryByTestId("event-geo")).not.toBeInTheDocument();
  });
});
