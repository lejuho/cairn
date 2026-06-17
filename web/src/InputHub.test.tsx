import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRow, TodaySurface } from "@cairn/shared";
import { InputHub } from "./InputHub.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const QUIET_SURFACE: TodaySurface = {
  date: "2026-06-17", now: "2026-06-17T09:00:00+09:00", state: "quiet",
  nextEvent: null, conflicts: [], twoMinuteTasks: [], watcherBubbles: [],
  needsReviewEvents: [], unscheduledEvents: [], dayEvents: [], cards: []
};

const UNSCHEDULED_EVENT: EventRow = {
  id: 42, title: "독서", start: null, end: null, source: "cairn", selfImposed: 1,
  status: "planned", threadId: null, type: null, location: null,
  createdAt: null, updatedAt: null
};

const SLOT_CANDIDATE = {
  start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00",
  reasons: ["09:00 — 빈 시간"], reasonCodes: ["free_window"]
};

function mockFetch(todaySurface: TodaySurface = QUIET_SURFACE, threads: unknown[] = []) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/api/threads")) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: threads }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: todaySurface }) });
  }));
}

type MockCall = [string, RequestInit?];
function getCalls(mock: ReturnType<typeof vi.fn>): MockCall[] {
  return mock.mock.calls as unknown as MockCall[];
}

// ── loading state ─────────────────────────────────────────────────────────────

describe("InputHub — loading state", () => {
  it("shows loading indicator initially", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<InputHub />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ── quiet state ───────────────────────────────────────────────────────────────

describe("InputHub — quiet state", () => {
  it("shows capture and form sections when no unscheduled events", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => {
      expect(screen.getByTestId("input-quiet")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument();
    expect(screen.getByLabelText("빠른 입력 저장")).toBeInTheDocument();
  });
});

// ── live state ────────────────────────────────────────────────────────────────

describe("InputHub — live state", () => {
  it("shows unscheduled events section", async () => {
    mockFetch({ ...QUIET_SURFACE, unscheduledEvents: [UNSCHEDULED_EVENT] });
    render(<InputHub />);
    await waitFor(() => {
      expect(screen.getByTestId("input-live")).toBeInTheDocument();
    });
    expect(screen.getByText("독서")).toBeInTheDocument();
    expect(screen.getByLabelText("독서 날짜 잡기")).toBeInTheDocument();
  });
});

// ── error state ───────────────────────────────────────────────────────────────

describe("InputHub — error state", () => {
  it("shows error and retry when today fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "서버 오류" } }) });
    }));
    render(<InputHub />);
    await waitFor(() => {
      expect(screen.getByTestId("input-error")).toBeInTheDocument();
    });
    expect(screen.getByText("서버 오류")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

// ── quick capture ─────────────────────────────────────────────────────────────

describe("InputHub — quick capture", () => {
  it("empty submit does not call fetch", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    const submitBtn = screen.getByLabelText("빠른 입력 저장");
    expect(submitBtn).toBeDisabled();
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(submitBtn);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("valid capture posts and shows saved message", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "내일 3시 치과" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));
    await waitFor(() => {
      expect(screen.getByText("저장됐어")).toBeInTheDocument();
    });
  });

  it("raw-stored result shows '날짜 없이 저장됐어'", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "raw_stored" } }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "운동" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));
    await waitFor(() => {
      expect(screen.getByText("날짜 없이 저장됐어")).toBeInTheDocument();
    });
  });
});

// ── manual add — event form ───────────────────────────────────────────────────

describe("InputHub — event form", () => {
  it("posts RFC3339 offset strings when event form submitted", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "팀 회의" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      const calls = getCalls(fetchMock);
      const eventsCall = calls.find(([u]) => u === "/api/events");
      expect(eventsCall).toBeDefined();
      const body = JSON.parse(eventsCall![1]!.body as string);
      expect(body.start).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
      expect(body.end).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
      expect(body.title).toBe("팀 회의");
    });
  });

  it("shows error when event form missing required field", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "title only" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});

// ── manual add — task form ────────────────────────────────────────────────────

describe("InputHub — task form", () => {
  it("posts expected payload when task form submitted", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("할 일 제목"), { target: { value: "코드 리뷰" } });
    fireEvent.change(screen.getByLabelText("예상 시간"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("할 일 저장"));
    await waitFor(() => {
      const calls = getCalls(fetchMock);
      const tasksCall = calls.find(([u]) => u === "/api/tasks");
      expect(tasksCall).toBeDefined();
      const body = JSON.parse(tasksCall![1]!.body as string);
      expect(body.title).toBe("코드 리뷰");
      expect(body.estMinutes).toBe(30);
    });
  });

  it("includes threadId when thread selected", async () => {
    const thread = { thread: { id: 7, name: "프로젝트", createdAt: "2026-01-01T00:00:00+00:00", updatedAt: "2026-01-01T00:00:00+00:00" }, events: [], tasks: [], replies: [] };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [thread] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("할 일 제목"), { target: { value: "작업" } });
    const selects = screen.getAllByLabelText("스레드");
    fireEvent.change(selects[0]!, { target: { value: "7" } });
    fireEvent.click(screen.getByLabelText("할 일 저장"));
    await waitFor(() => {
      const calls = getCalls(fetchMock);
      const tasksCall = calls.find(([u]) => u === "/api/tasks");
      expect(tasksCall).toBeDefined();
      const body = JSON.parse(tasksCall![1]!.body as string);
      expect(body.threadId).toBe(7);
    });
  });
});

// ── unscheduled events ────────────────────────────────────────────────────────

describe("InputHub — unscheduled events", () => {
  it("loads slot candidates when 날짜 잡기 clicked", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("slot-candidates")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { candidates: [SLOT_CANDIDATE] } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...QUIET_SURFACE, unscheduledEvents: [UNSCHEDULED_EVENT] } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-live")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => {
      expect(screen.getByText(/2026-06-20/)).toBeInTheDocument();
    });
  });

  it("candidate selection patches schedule and refetches hub", async () => {
    let afterSchedule = false;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("slot-candidates")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { candidates: [SLOT_CANDIDATE] } }) });
      if (url.includes("/schedule") && init?.method === "PATCH") {
        afterSchedule = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
      }
      const events = afterSchedule ? [] : [UNSCHEDULED_EVENT];
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...QUIET_SURFACE, unscheduledEvents: events } }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-live")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => expect(screen.getByText(/2026-06-20/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/2026-06-20/));
    await waitFor(() => {
      expect(afterSchedule).toBe(true);
    });
  });

  it("shows error when slot-candidates fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("slot-candidates")) return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "오류 발생" } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...QUIET_SURFACE, unscheduledEvents: [UNSCHEDULED_EVENT] } }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-live")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("독서 날짜 잡기"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});

// ── thread picker degrades gracefully ─────────────────────────────────────────

describe("InputHub — thread picker degrades gracefully", () => {
  it("renders without thread picker when threads fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.queryByLabelText("스레드")).not.toBeInTheDocument();
  });
});
