import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./Today.js";
import type { ConflictDecision, DayFeasibility, EventDetailData, FeasibilityParamSettingsData, TodaySurface } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  }
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
      expect(screen.getByText("기록")).toBeInTheDocument();
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
      event: REVIEW_EVENT, people: [], annotations: [], thread: null, scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], reasonCodes: [] }
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
      thread: { id: 3, name: "Work Thread", kind: "project", goal: null, definitionOfDone: null, deadline: null, status: "active" as const, createdAt: null },
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

describe("Today — quick capture", () => {
  function mockQuiet() {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("/api/capture/flat-event") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
      }
      if ((url as string) === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    }));
  }

  it("renders quick capture input in quiet state", async () => {
    mockQuiet();
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument();
  });

  it("renders quick capture input in live state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if ((url as string) === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "live" } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument());
  });

  it("empty submit does not call fetch capture endpoint", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if ((url as string) === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));
    // only initial load + thread list — no capture call
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("flat-event"), expect.anything());
  });

  it("scheduled capture calls endpoint and refetches", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("flat-event") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
      }
      if ((url as string) === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "내일 오후 2시 치과" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("flat-event"), expect.objectContaining({ method: "POST" }));
    });
    // no savedMsg for scheduled
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("raw/unscheduled outcome shows saved-without-date message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if ((url as string).includes("flat-event") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "raw_stored" } }) });
      }
      if ((url as string) === "/api/threads") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "quiet" } }) });
    }));
    render(<Today />);
    await waitFor(() => expect(screen.getByTestId("today-quiet")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "독서" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("날짜 없이 저장됐어");
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
      scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], reasonCodes: [] }
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
    await waitFor(() => expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "내일 9시 회의" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));
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
    scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], reasonCodes: [] }
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
    }
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
    dayEvents: [], cards: [{ kind: "conflict", pair: { a: eventA, b: eventB } }],
    feasibility: {
      date: "2026-06-20", now: "2026-06-20T09:00:00+09:00",
      params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
      energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" },
      gaps: [], continuous: null, transitionCosts: [],
      sequenceEnergy: {
        workLoadUnits: 0, transitionLoadUnits: 0, totalLoadUnits: 0, budgetUnits: 8, remainingUnits: 8,
        deficit: false, unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"]
      }
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
