import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./Today.js";
import type { TodaySurface } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_SURFACE: TodaySurface = {
  date: "2026-06-16",
  now: "2026-06-16T09:00:00.000Z",
  state: "quiet",
  nextEvent: null,
  conflicts: [],
  twoMinuteTasks: [],
  watcherBubbles: [],
  needsReviewEvents: [],
  dayEvents: [],
  cards: []
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
    vi.fn().mockRejectedValue(new Error(message))
  );
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

  it("event with threadId renders as link to /threads/:id", async () => {
    const linkedEvent = { ...DAY_EVENT_A, threadId: 7 };
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      dayEvents: [linkedEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByRole("link", { name: "오전 회의" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "오전 회의" })).toHaveAttribute("href", "/threads/7");
  });

  it("event without threadId renders as plain text, not a link", async () => {
    const unlinkedEvent = { ...DAY_EVENT_B, threadId: null };
    mockFetch({
      ...BASE_SURFACE,
      state: "live",
      dayEvents: [unlinkedEvent],
      cards: []
    });
    render(<Today />);
    await waitFor(() => expect(screen.getByText("오후 미팅")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "오후 미팅" })).not.toBeInTheDocument();
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
