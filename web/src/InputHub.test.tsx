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
  needsReviewEvents: [], unscheduledEvents: [], dueTaskSchedulePrompts: [], dayEvents: [], cards: [],
  feasibility: {
    date: "2026-06-17", now: "2026-06-17T09:00:00+09:00",
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

const UNSCHEDULED_EVENT: EventRow = {
  id: 42, title: "독서", start: null, end: null, source: "cairn", selfImposed: 1,
  status: "planned", threadId: null, type: null, location: null,
  mode: null,
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
  it("shows the Composer and a collapsed 고급 입력 toggle when no unscheduled events", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => {
      expect(screen.getByTestId("input-quiet")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument();
    expect(screen.getByLabelText("만들기")).toBeInTheDocument();
    // advanced manual forms collapsed by default
    const advancedToggle = screen.getByRole("button", { name: /고급 입력/ });
    expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("일정 추가 폼")).not.toBeInTheDocument();
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

describe("InputHub — Composer 일정 mode", () => {
  it("empty submit does not call fetch", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: "scheduled" } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    const submitBtn = screen.getByLabelText("만들기");
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
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "내일 3시 치과" } });
    fireEvent.click(screen.getByLabelText("만들기"));
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
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "운동" } });
    fireEvent.click(screen.getByLabelText("만들기"));
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
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "운동" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("캡처 오류")).toBeInTheDocument();
    expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "title only" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("posts selected event mode and omits mode when none selected", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "발표" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "비대면" }));
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      const body = JSON.parse(getCalls(fetchMock).find(([u]) => u === "/api/events")![1]!.body as string);
      expect(body.mode).toBe("remote");
    });
  });

  it("omits mode from payload when no chip selected", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "발표" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    await waitFor(() => {
      const body = JSON.parse(getCalls(fetchMock).find(([u]) => u === "/api/events")![1]!.body as string);
      expect("mode" in body).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    expect(screen.queryByRole("group", { name: "참석자" })).not.toBeInTheDocument();
  });

  it("shows people checkboxes when people exist", async () => {
    mockFetch(QUIET_SURFACE, [], [ALICE, BOB]);
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
    expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    await waitFor(() => expect(screen.getByLabelText("일정 추가 폼")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Alice 요일 제약 설정"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  }

  it("shows 제약 button for each person in the checklist", async () => {
    setupConstraintMock();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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
      const putCall = getCalls(fetchMock).find(
        ([url, init]) => url.includes("/hard-constraints") && init?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1]!.body as string);
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
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
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

describe("InputHub — creation result cards (cycle-68)", () => {
  function mockCapture(captureStatus: string) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus } }) });
    }));
  }
  function mockSaveOk() {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/today")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }));
  }

  it("scheduled quick capture shows a 일정 result card linking to Today", async () => {
    mockCapture("scheduled");
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "내일 3시 치과" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("capture-result");
    expect(card).toHaveTextContent("일정");
    expect(card).toHaveTextContent("저장됐어");
    const link = within(card).getByText("Today에서 보기");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/today");
  });

  it("raw-stored quick capture shows a 미정 일정 result card with a 날짜 잡기 action", async () => {
    mockCapture("raw_stored");
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "운동" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("capture-result");
    expect(card).toHaveTextContent("미정 일정");
    expect(card).toHaveTextContent("날짜 없이 저장됐어");
    const action = within(card).getByText("날짜 잡기");
    expect(action.tagName).toBe("BUTTON"); // refresh-to-list, not navigation
    fireEvent.click(action);
    await waitFor(() => expect(screen.queryByTestId("capture-result")).not.toBeInTheDocument());
  });

  it("manual event success shows a 일정 result card", async () => {
    mockSaveOk();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "팀 회의" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "2026-06-20T10:00" } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: "2026-06-20T11:00" } });
    fireEvent.click(screen.getByLabelText("일정 저장"));
    const card = await screen.findByTestId("manual-result");
    expect(card).toHaveTextContent("일정");
    expect(within(card).getByText("Today에서 보기")).toHaveAttribute("href", "/today");
  });

  it("manual task success shows a 할 일 result card", async () => {
    mockSaveOk();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    fireEvent.click(screen.getByRole("tab", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("할 일 제목"), { target: { value: "코드 리뷰" } });
    fireEvent.change(screen.getByLabelText("예상 시간"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("할 일 저장"));
    const card = await screen.findByTestId("manual-result");
    expect(card).toHaveTextContent("할 일");
    expect(within(card).getByText("Today에서 보기")).toHaveAttribute("href", "/today");
  });
});

describe("InputHub — Composer (cycle-69)", () => {
  const DRAFT = { thread: { id: 9, name: "파리 여행" }, events: [{}], tasks: [{}, {}], nodeLinks: [{}], warnings: [{ message: "날짜가 필요해" }] };
  function recordingFetch(opts: { captureStatus?: string; ok?: boolean } = {}) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes("/api/threads/draft")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "초안 실패" } } : { ok: true, data: DRAFT }) });
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/tasks")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "할 일 실패" } } : { ok: true }) });
      if (url.includes("/api/capture/flat-event")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { captureStatus: opts.captureStatus ?? "scheduled" } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: QUIET_SURFACE }) });
    }));
    return calls;
  }
  const posts = (calls: Array<{ url: string; method: string; body: unknown }>) => calls.filter((c) => c.method === "POST");

  it("renders the Composer in the live state", async () => {
    mockFetch({ ...QUIET_SURFACE, unscheduledEvents: [UNSCHEDULED_EVENT] });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-live")).toBeInTheDocument());
    expect(screen.getByLabelText("만들기 입력")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "만들기 종류" })).toBeInTheDocument();
  });

  it("has exactly three modes; switching mode updates pressed state without submitting", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    for (const label of ["일정", "스레드", "할 일"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일정" })).toHaveAttribute("aria-pressed", "true");
    const before = posts(calls).length;
    fireEvent.click(screen.getByRole("button", { name: "스레드" }));
    expect(screen.getByRole("button", { name: "스레드" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "일정" })).toHaveAttribute("aria-pressed", "false");
    expect(posts(calls).length).toBe(before); // mode switch makes no request
  });

  it("empty Composer text leaves submit disabled", async () => {
    recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.getByLabelText("만들기")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "   " } }); // whitespace
    expect(screen.getByLabelText("만들기")).toBeDisabled();
  });

  it("일정 mode posts only to /api/capture/flat-event", async () => {
    const calls = recordingFetch({ captureStatus: "scheduled" });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "내일 3시 치과" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await screen.findByTestId("capture-result");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/capture/flat-event");
  });

  it("스레드 mode posts only to /api/threads/draft and shows a 스레드 초안 card with counts, warning, and link", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "스레드" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "파리 여행 준비" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("thread-draft-success");
    expect(card).toHaveTextContent("스레드 초안");
    expect(card).toHaveTextContent("이벤트 1");
    expect(card).toHaveTextContent("작업 2");
    expect(card).toHaveTextContent("연결 1");
    expect(screen.getByTestId("draft-warning")).toHaveTextContent("날짜가 필요해");
    expect(screen.getByTestId("draft-open-link")).toHaveAttribute("href", "/threads/9");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/threads/draft");
    expect(p[0]!.body).toEqual({ text: "파리 여행 준비" });
  });

  it("할 일 mode posts only to /api/tasks with { title } and shows a 할 일 card", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "코드 리뷰" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("task-result");
    expect(card).toHaveTextContent("할 일");
    expect(within(card).getByText("Today에서 보기")).toHaveAttribute("href", "/today");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/tasks");
    expect(p[0]!.body).toEqual({ title: "코드 리뷰" });
  });

  it("Composer submit failure keeps the selected mode and typed text and shows a local error", async () => {
    recordingFetch({ ok: false });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "유지될 텍스트" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("할 일 실패"));
    expect(screen.getByRole("button", { name: "할 일" })).toHaveAttribute("aria-pressed", "true"); // mode kept
    expect(screen.getByLabelText("만들기 입력")).toHaveValue("유지될 텍스트"); // text kept
  });

  it("고급 입력 is collapsed by default and opens the existing manual forms", async () => {
    mockFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    expect(screen.queryByLabelText("일정 추가 폼")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /고급 입력/ }));
    expect(screen.getByLabelText("일정 추가 폼")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "할 일" })).toBeInTheDocument();
  });
});

describe("InputHub — Watcher & 기록 Composer modes (cycle-71)", () => {
  const DAY_EVENT = { ...UNSCHEDULED_EVENT, id: 77, title: "팀 회의", start: "2026-06-17T10:00:00+09:00", end: "2026-06-17T11:00:00+09:00" };
  function recordingFetch(opts: { surfaceDayEvents?: unknown[]; ok?: boolean; parseStatus?: string } = {}) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes("/api/threads")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/people")) return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: [] }) });
      if (url.includes("/api/watchers")) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "watcher 실패" } } : { ok: true, data: { id: 9 } }) });
      if (/\/api\/events\/\d+\/annotations/.test(url)) return Promise.resolve({ json: () => Promise.resolve(opts.ok === false ? { ok: false, error: { message: "기록 실패" } } : { ok: true, data: { annotation: { id: 1 }, parseStatus: opts.parseStatus ?? "parsed" } }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { ...QUIET_SURFACE, dayEvents: opts.surfaceDayEvents ?? [] } }) });
    }));
    return calls;
  }
  const posts = (calls: Array<{ url: string; method: string; body: unknown }>) => calls.filter((c) => c.method === "POST");

  it("Composer exposes five modes including Watcher and 기록", async () => {
    recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    for (const label of ["일정", "스레드", "할 일", "Watcher", "기록"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("Watcher mode shows subtype controls and does not submit on switch", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    expect(screen.getByTestId("watcher-fields")).toBeInTheDocument();
    for (const s of ["날짜 기반", "역산 계획", "수동 확인"]) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
    expect(screen.getByLabelText("만들기")).toBeDisabled(); // no label + no threshold
  });

  it("date-threshold watcher posts only to /api/watchers with label + threshold → /watch card", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "여권 갱신" } });
    fireEvent.change(screen.getByLabelText("watcher 마감일"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("watcher-result");
    expect(within(card).getByText("지켜볼 것에서 보기")).toHaveAttribute("href", "/watch");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/watchers");
    expect(p[0]!.body).toMatchObject({ label: "여권 갱신", threshold: "2026-07-01" });
  });

  it("reverse-plan watcher posts only to /api/watchers/reverse-plan with targetDate + steps", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "출국 준비" } });
    fireEvent.click(screen.getByRole("button", { name: "역산 계획" }));
    fireEvent.change(screen.getByLabelText("목표 날짜"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("단계 1 이름"), { target: { value: "비자 신청" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await screen.findByTestId("watcher-result");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/watchers/reverse-plan");
    expect(p[0]!.body).toMatchObject({ label: "출국 준비", targetDate: "2026-08-01", steps: [{ label: "비자 신청" }] });
  });

  it("manual-exogenous watcher posts only to /api/watchers/manual-exogenous", async () => {
    const calls = recordingFetch();
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "환율 고시" } });
    fireEvent.click(screen.getByRole("button", { name: "수동 확인" }));
    fireEvent.click(screen.getByLabelText("만들기"));
    await screen.findByTestId("watcher-result");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toContain("/api/watchers/manual-exogenous");
    expect(p[0]!.body).toMatchObject({ label: "환율 고시", sourceStability: "unknown" });
  });

  it("watcher API failure preserves label and shows local error", async () => {
    recordingFetch({ ok: false });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Watcher" }));
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "유지될 라벨" } });
    fireEvent.change(screen.getByLabelText("watcher 마감일"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("watcher 실패"));
    expect(screen.getByLabelText("만들기 입력")).toHaveValue("유지될 라벨");
  });

  it("기록 mode shows a no-target message and disables submit when no events", async () => {
    recordingFetch({ surfaceDayEvents: [] });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    expect(screen.getByTestId("record-no-target")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "메모" } });
    expect(screen.getByLabelText("만들기")).toBeDisabled();
  });

  it("기록 submit posts only to /api/events/:id/annotations {text} and shows a 기록 card (raw_stored keeps raw status)", async () => {
    const calls = recordingFetch({ surfaceDayEvents: [DAY_EVENT], parseStatus: "raw_stored" });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    fireEvent.change(screen.getByLabelText("기록할 이벤트"), { target: { value: "77" } });
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "회의 잘 끝남" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    const card = await screen.findByTestId("record-result");
    expect(card).toHaveTextContent("팀 회의");
    expect(card).toHaveTextContent("원문 저장됨");
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0]!.url).toBe("/api/events/77/annotations");
    expect(p[0]!.body).toEqual({ text: "회의 잘 끝남" });
  });

  it("record API failure preserves text and selected target", async () => {
    recordingFetch({ surfaceDayEvents: [DAY_EVENT], ok: false });
    render(<InputHub />);
    await waitFor(() => expect(screen.getByTestId("input-quiet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    fireEvent.change(screen.getByLabelText("기록할 이벤트"), { target: { value: "77" } });
    fireEvent.change(screen.getByLabelText("만들기 입력"), { target: { value: "유지될 기록" } });
    fireEvent.click(screen.getByLabelText("만들기"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("기록 실패"));
    expect(screen.getByLabelText("만들기 입력")).toHaveValue("유지될 기록");
    expect((screen.getByLabelText("기록할 이벤트") as HTMLSelectElement).value).toBe("77");
  });
});
