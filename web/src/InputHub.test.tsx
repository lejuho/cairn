import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRow, PersonRow, TodaySurface } from "@cairn/shared";
import { InputHub } from "./InputHub.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const QUIET_SURFACE: TodaySurface = {
  date: "2026-06-17", now: "2026-06-17T09:00:00+09:00", state: "quiet",
  nextEvent: null, conflicts: [], twoMinuteTasks: [], watcherBubbles: [],
  needsReviewEvents: [], unscheduledEvents: [], dayEvents: [], cards: [],
  feasibility: {
    date: "2026-06-17", now: "2026-06-17T09:00:00+09:00",
    params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
    energy: { loadUnits: 0, budgetUnits: 8, remainingUnits: 8, deficit: false, confidence: "cold_start" },
    gaps: [], continuous: null
  }
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

function mockFetch(todaySurface: TodaySurface = QUIET_SURFACE, threads: unknown[] = [], people: PersonRow[] = []) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: threads }) });
    if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: people }) });
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: todaySurface }) });
  }));
}

const ALICE: PersonRow = { id: 1, name: "Alice", relation: null, channel: null };
const BOB: PersonRow = { id: 2, name: "Bob", relation: "동료", channel: "kakao" };

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

describe("InputHub — Access session error state", () => {
  it("shows 로그인 세션이 필요해 and recovery button on rejected fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByText("로그인 세션이 필요해")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("Access 로그인 다시 열기 triggers full-page navigation in InputHub", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const assignMock = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/input", assign: assignMock });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Access 로그인 다시 열기" }));
    expect(assignMock).toHaveBeenCalledWith("http://localhost/input");
    vi.unstubAllGlobals();
  });

  it("generic API failure still shows generic error not Access copy", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "API 오류" } }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-error")).toBeInTheDocument());
    expect(screen.queryByText("로그인 세션이 필요해")).not.toBeInTheDocument();
    expect(screen.getByText("API 오류")).toBeInTheDocument();
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

  it("capture failure keeps input visible and shows local error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "캡처 오류" } }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("빠른 입력"), { target: { value: "운동" } });
    fireEvent.click(screen.getByLabelText("빠른 입력 저장"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("캡처 오류")).toBeInTheDocument();
    expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument();
  });
});

// ── manual add — event form ───────────────────────────────────────────────────

describe("InputHub — event form", () => {
  it("posts RFC3339 offset strings with local timezone (KST +09:00)", async () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
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
      expect(body.start).toBe("2026-06-20T10:00:00+09:00");
      expect(body.end).toBe("2026-06-20T11:00:00+09:00");
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

// ── local date (ISSUE-2) ──────────────────────────────────────────────────────

describe("InputHub — local date for API requests", () => {
  it("uses local date (not UTC) for /api/today request", async () => {
    // Simulate KST date: local June 20 while UTC would be June 19
    vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
    vi.spyOn(Date.prototype, "getMonth").mockReturnValue(5); // June (0-indexed)
    vi.spyOn(Date.prototype, "getDate").mockReturnValue(20);
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    const calls = getCalls(fetchMock);
    const todayCall = calls.find(([u]) => typeof u === "string" && u.includes("/api/today"));
    expect(todayCall).toBeDefined();
    expect(todayCall![0]).toContain("date=2026-06-20");
  });
});

// ── people checklist ──────────────────────────────────────────────────────────

describe("InputHub — people checklist", () => {
  it("people checklist hidden when no people exist", async () => {
    mockFetch(QUIET_SURFACE, [], []);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "참석자" })).not.toBeInTheDocument();
  });

  it("shows people checkboxes when people exist", async () => {
    mockFetch(QUIET_SURFACE, [], [ALICE, BOB]);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "참석자" })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bob")).toBeInTheDocument();
  });

  it("checked personId included in event POST payload", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [ALICE] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Alice"));
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "미팅" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      const calls = getCalls(fetchMock);
      const eventsCall = calls.find(([u]) => u === "/api/events");
      expect(eventsCall).toBeDefined();
      const body = JSON.parse(eventsCall![1]!.body as string);
      expect(body.personIds).toEqual([1]);
    });
  });

  it("unchecked person not included in POST payload", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [ALICE] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "미팅" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      const calls = getCalls(fetchMock);
      const eventsCall = calls.find(([u]) => u === "/api/events");
      expect(eventsCall).toBeDefined();
      const body = JSON.parse(eventsCall![1]!.body as string);
      expect(body.personIds).toBeUndefined();
    });
  });
});

// ── inline person creation ────────────────────────────────────────────────────

describe("InputHub — inline person creation", () => {
  it("'+ 사람 추가' button shows inline form", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    expect(screen.getByLabelText("새 사람 이름")).toBeInTheDocument();
    expect(screen.getByLabelText("연락 채널")).toBeInTheDocument();
  });

  it("creating new person adds to checklist and auto-selects", async () => {
    const CREATED_PERSON = { id: 5, name: "Charlie", relation: "친구", channel: "kakao" };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url === "/api/people" && init?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: CREATED_PERSON } }) });
      }
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [CREATED_PERSON] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    fireEvent.change(screen.getByLabelText("새 사람 이름"), { target: { value: "Charlie" } });
    fireEvent.change(screen.getByLabelText("관계"), { target: { value: "친구" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Charlie")).toBeInTheDocument();
    });
    const checkbox = screen.getByLabelText("Charlie") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByLabelText("새 사람 이름")).not.toBeInTheDocument();
    const calls = getCalls(fetchMock);
    const postCall = calls.find(([u, i]) => u === "/api/people" && (i as RequestInit)?.method === "POST");
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.relation).toBe("친구");
    const refreshCalls = calls.filter(([u, i]) => u === "/api/people" && !(i as RequestInit | undefined)?.method);
    expect(refreshCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("relation sent in POST body when filled", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url === "/api/people" && init?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: { id: 9, name: "Dana", relation: "동료", channel: "sms" } } }) });
      }
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    fireEvent.change(screen.getByLabelText("새 사람 이름"), { target: { value: "Dana" } });
    fireEvent.change(screen.getByLabelText("관계"), { target: { value: "동료" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => {
      const postCalls = getCalls(fetchMock).filter(([u, i]) => u === "/api/people" && (i as RequestInit)?.method === "POST");
      expect(postCalls.length).toBe(1);
    });
    const calls = getCalls(fetchMock);
    const postCall = calls.find(([u, i]) => u === "/api/people" && (i as RequestInit)?.method === "POST");
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.relation).toBe("동료");
  });

  it("blank relation not sent in POST body", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url === "/api/people" && init?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: { id: 10, name: "Eve", relation: null, channel: "none" } } }) });
      }
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    fireEvent.change(screen.getByLabelText("새 사람 이름"), { target: { value: "Eve" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => {
      const postCalls = getCalls(fetchMock).filter(([u, i]) => u === "/api/people" && (i as RequestInit)?.method === "POST");
      expect(postCalls.length).toBe(1);
    });
    const calls = getCalls(fetchMock);
    const postCall = calls.find(([u, i]) => u === "/api/people" && (i as RequestInit)?.method === "POST");
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.relation).toBeUndefined();
  });

  it("person creation error shows alert", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url === "/api/people" && init?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "이름 중복" } }) });
      }
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    fireEvent.change(screen.getByLabelText("새 사람 이름"), { target: { value: "Charlie" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("이름 중복")).toBeInTheDocument();
    expect(screen.getByLabelText("새 사람 이름")).toBeInTheDocument();
  });

  it("취소 hides inline form", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 사람 추가" }));
    expect(screen.getByLabelText("새 사람 이름")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("새 사람 이름")).not.toBeInTheDocument();
  });
});

// ── thread picker degrades gracefully ─────────────────────────────────────────

describe("InputHub — thread picker degrades gracefully", () => {
  it("renders without thread picker when threads returns ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.queryByLabelText("스레드")).not.toBeInTheDocument();
  });

  it("renders input sections when threads fetch rejects at network layer", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.reject(new Error("Network error"));
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
    }));
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.getByLabelText("빠른 입력")).toBeInTheDocument();
    expect(screen.queryByLabelText("스레드")).not.toBeInTheDocument();
  });
});

// ── InputHub — constraint sheet ───────────────────────────────────────────────

describe("InputHub — constraint sheet", () => {
  const ALICE_WITH_CONSTRAINTS: PersonRow = {
    id: 1, name: "Alice", relation: null, channel: null,
    hardConstraints: [{ type: "weekday_unavailable", weekday: "monday", text: "monday 불가", firmness: "hard" }]
  };

  function setupConstraintMock(people: PersonRow[] = [ALICE_WITH_CONSTRAINTS]) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: people }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }));
  }

  async function renderAndOpenSheet() {
    render(<InputHub />);
    await waitFor(() => expect(screen.getByLabelText("일정 추가 폼")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Alice 요일 제약 설정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  }

  it("shows 제약 button for each person in the checklist", async () => {
    setupConstraintMock();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByLabelText("Alice 요일 제약 설정")).toBeInTheDocument());
  });

  it("clicking 제약 button opens constraint sheet with person name", async () => {
    setupConstraintMock();
    await renderAndOpenSheet();
    expect(screen.getByRole("dialog", { name: "Alice 요일 제약" })).toBeInTheDocument();
  });

  it("constraint sheet shows all 7 weekday toggle buttons", async () => {
    setupConstraintMock();
    await renderAndOpenSheet();
    expect(screen.getByRole("button", { name: "월" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "토" })).toBeInTheDocument();
  });

  it("existing constraint pre-selects the weekday toggle", async () => {
    setupConstraintMock();
    await renderAndOpenSheet();
    expect(screen.getByRole("button", { name: "월" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "화" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggling a weekday changes its aria-pressed state", async () => {
    setupConstraintMock();
    await renderAndOpenSheet();
    fireEvent.click(screen.getByRole("button", { name: "화" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "화" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("save calls PUT /api/people/:id/hard-constraints with correct weekdays", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people") && !url.includes("hard-constraints")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [ALICE_WITH_CONSTRAINTS] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_WITH_CONSTRAINTS } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderAndOpenSheet();
    fireEvent.click(screen.getByRole("button", { name: "수" })); // add wednesday
    fireEvent.click(screen.getByRole("button", { name: "제약 저장" }));
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/hard-constraints") && c[1]?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body as string);
      expect(body.unavailableWeekdays).toContain("monday");
      expect(body.unavailableWeekdays).toContain("wednesday");
    });
  });

  it("save success closes constraint sheet without losing event person selection", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people") && !url.includes("hard-constraints")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [ALICE_WITH_CONSTRAINTS] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_WITH_CONSTRAINTS } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByLabelText("일정 추가 폼")).toBeInTheDocument());
    // Select Alice in the event form
    const checkbox = screen.getByRole("checkbox", { name: /Alice/ });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    // Open and save constraint sheet
    fireEvent.click(screen.getByLabelText("Alice 요일 제약 설정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "제약 저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Alice checkbox still checked
    expect(screen.getByRole("checkbox", { name: /Alice/ })).toBeChecked();
  });

  it("save failure keeps sheet open with error message", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people") && !url.includes("hard-constraints")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [ALICE_WITH_CONSTRAINTS] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "저장 실패" } }) });
    }));
    await renderAndOpenSheet();
    fireEvent.click(screen.getByRole("button", { name: "제약 저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장 실패"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("취소 button closes constraint sheet", async () => {
    setupConstraintMock();
    await renderAndOpenSheet();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
