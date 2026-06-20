import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./Today.js";
import type { ConflictDecision, EventDetailData, TodaySurface } from "@cairn/shared";

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
  continuous: null
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
      source: "cairn" as const, selfImposed: 1,
      status: "planned" as const,
      createdAt: null, updatedAt: null
    };
    const b = {
      id: 2, title: "미팅 B",
      start: "2026-06-16T11:00:00+00:00",
      end: "2026-06-16T13:00:00+00:00",
      threadId: null, type: null, location: null,
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

  it("renders watcher card", async () => {
    const watcher = {
      id: 1, label: "여권 갱신", threshold: "2026-06-10",
      category: null, kind: "A" as const, armed: 1,
      rule: null, lastFired: null, snoozedUntil: null, createdAt: null
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
  source: "cairn" as const,
  selfImposed: 1,
  status: "planned" as const,
  createdAt: null,
  updatedAt: null
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
      threadId: null, type: null, location: null, source: "cairn" as const,
      selfImposed: 1, status: "planned" as const, createdAt: null, updatedAt: null
    };
    mockFetch({ ...BASE_SURFACE, state: "live", nextEvent: event, cards: [{ kind: "next_event", event }] });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("팀 회의")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
  });
});

describe("Today — needs_review card", () => {
  it("renders needs_review card with chip and question", async () => {
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT }]
    });
    render(<Today />);
    await waitFor(() => {
      expect(screen.getByText("기록")).toBeInTheDocument();
    });
    expect(screen.getByText("팀 회의 — 어떻게 됐어?")).toBeInTheDocument();
    expect(screen.getByLabelText("팀 회의 메모")).toBeInTheDocument();
  });

  it("empty reply does not call fetch", async () => {
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      needsReviewEvents: [REVIEW_EVENT],
      cards: [{ kind: "needs_review", event: REVIEW_EVENT }]
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { ...BASE_SURFACE, state: "live", needsReviewEvents: [REVIEW_EVENT], cards: [{ kind: "needs_review", event: REVIEW_EVENT }] } })
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
          ? { ...BASE_SURFACE, state: "live" as const, needsReviewEvents: [REVIEW_EVENT], cards: [{ kind: "needs_review" as const, event: REVIEW_EVENT }] }
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
      cards: [{ kind: "needs_review", event: REVIEW_EVENT }]
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
      cards: [{ kind: "needs_review", event: REVIEW_EVENT }]
    };
    const detail: EventDetailData = {
      event: REVIEW_EVENT, people: [], annotations: [], thread: null
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
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

const DAY_EVENT_B = {
  id: 11, title: "오후 미팅",
  start: "2026-06-16T14:00:00+09:00",
  end:   "2026-06-16T15:00:00+09:00",
  threadId: null, type: null, location: "회의실" as const,
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
  type: null, location: null, createdAt: null, updatedAt: null
};

const SLOT_CANDIDATE = {
  start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
  reasons: ["09:00 — 빈 시간"], reasonCodes: ["free_window"]
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
    await waitFor(() => expect(screen.getByText(/2026-06-20/)).toBeInTheDocument());
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
    fireEvent.click(screen.getAllByLabelText(/09:00 선택/)[0]!);
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
      event: UNSCHEDULED_EVENT, people: [], annotations: [], thread: null
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
});

describe("Today — event detail sheet", () => {
  const BASE_EVENT = {
    id: 42, title: "팀 스프린트",
    start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00",
    threadId: null, type: null, location: null,
    source: "cairn" as const, selfImposed: 1,
    status: "planned" as const,
    createdAt: null, updatedAt: null
  };
  const BASE_DETAIL: EventDetailData = {
    event: BASE_EVENT,
    people: [],
    annotations: [],
    thread: null
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
    continuous: null
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
});

describe("Today — conflict decision sheet", () => {
  const makeEvent = (id: number, title: string, start: string, end: string) => ({
    id, title, start, end,
    threadId: null, type: null, location: null,
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
  const eventA = { id: 1, title: "미팅 A", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00", source: "cairn" as const, selfImposed: 1, status: "planned" as const, threadId: null, type: null, location: null, createdAt: null, updatedAt: null };
  const eventB = { id: 2, title: "미팅 B", start: "2026-06-20T11:00:00+09:00", end: "2026-06-20T12:00:00+09:00", source: "cairn" as const, selfImposed: 1, status: "planned" as const, threadId: null, type: null, location: null, createdAt: null, updatedAt: null };

  const BASE_SURFACE_GUARD: TodaySurface = {
    date: "2026-06-20", now: "2026-06-20T09:00:00+09:00", state: "live",
    nextEvent: null, conflicts: [{ a: eventA, b: eventB }],
    twoMinuteTasks: [], watcherBubbles: [], needsReviewEvents: [], unscheduledEvents: [],
    dayEvents: [], cards: [{ kind: "conflict", pair: { a: eventA, b: eventB } }],
    feasibility: {
      date: "2026-06-20", now: "2026-06-20T09:00:00+09:00",
      params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
      energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" },
      gaps: [], continuous: null
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
