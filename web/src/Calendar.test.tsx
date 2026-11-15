import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CalendarData, EventRow, TaskRow } from "@cairn/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPage, cellLines, linesThatFit } from "./Calendar.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

beforeEach(() => {
  // 2026-11-12 (목) 정오 KST
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T03:00:00Z"));
  window.history.replaceState(null, "", "/calendar");
});

function event(over: Partial<EventRow>): EventRow {
  return {
    id: 1, threadId: null, title: "팀 회의", type: null, start: "2026-11-12T14:00:00+09:00", end: "2026-11-12T15:00:00+09:00",
    location: null, mode: null, source: "manual", selfImposed: 0, status: "planned", commitment: 2, reversible: 1,
    cancelMoney: 0, cancelSocial: 0, cancelEffort: "none", cancelWindow: null, refundCutoff: null,
    createdAt: null, updatedAt: null,
    ...over
  } as EventRow;
}

const DATA: CalendarData = {
  from: "2026-11-01", to: "2026-12-12", timeZone: "Asia/Seoul",
  events: [
    event({ id: 1, title: "팀 회의", location: "T동 501", threadId: 3 }),
    event({ id: 2, title: "엄마 생일", type: "all_day", start: "2026-11-02T00:00:00+09:00", end: "2026-11-03T00:00:00+09:00" }),
    event({ id: 3, title: "워크숍", start: "2026-11-20T10:00:00+09:00", end: "2026-11-21T17:00:00+09:00" })
  ],
  tasks: [{ id: 9, threadId: null, title: "보고서 초안", estMinutes: 60, due: "2026-11-12", context: null, status: "todo", optional: 0 } as TaskRow],
  outcomeRecordedEventIds: [],
  noteCounts: { "2026-11-12": 2 }
};

function surface(over: Record<string, unknown> = {}) {
  const feasibility = {
    date: "2026-11-12", now: "2026-11-12T03:00:00.000Z",
    params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 },
    energy: { loadUnits: 3, budgetUnits: 8, remainingUnits: 5, deficit: false, confidence: "cold_start" },
    gaps: [], continuous: null, transitionCosts: [],
    sequenceEnergy: {
      workLoadUnits: 3, transitionLoadUnits: 0, totalLoadUnits: 3, budgetUnits: 8, remainingUnits: 5,
      deficit: false, unknownTransitionCount: 0, confidence: "cold_start", reasonCodes: ["sequence_work_only"]
    }
  };
  return {
    date: "2026-11-12", now: "2026-11-12T03:00:00.000Z", state: "live", nextEvent: null, conflicts: [], twoMinuteTasks: [],
    watcherBubbles: [], needsReviewEvents: [], unscheduledEvents: [], dueTaskSchedulePrompts: [], dayEvents: [], cards: [],
    locationContexts: [], feasibility, notes: [],
    ...over
  };
}

function json(data: unknown, ok = true) {
  return { ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve(ok ? { ok: true, data } : { ok: false, error: { message: String(data) } }) };
}

function stubFetch(handler: (url: string) => unknown) {
  const mock = vi.fn((url: string) => Promise.resolve(handler(String(url))));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calendarOnly(data: CalendarData = DATA, today: unknown = surface()) {
  return stubFetch((url) => {
    if (url.startsWith("/api/calendar")) return json(data);
    if (url.startsWith("/api/today")) return json(today);
    return json({ notes: [], total: 0, related: [], targets: [] });
  });
}

describe("CalendarPage", () => {
  it("shows the month grid while loading and asks for six whole weeks", () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarPage />);
    expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "2026년 11월" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    expect((fetchMock.mock.calls as unknown as string[][]).some(([url]) => String(url) === "/api/calendar?from=2026-11-01&to=2026-12-12")).toBe(true);
  });

  it("highlights today and summarises each day", async () => {
    calendarOnly();
    render(<CalendarPage />);
    const today = await screen.findByRole("button", { name: "2026년 11월 12일 (목), 오늘, 일정 1건, 마감인 할 일 1건, 메모 2건" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2026년 11월 2일 (월), 일정 1건" })).not.toHaveAttribute("aria-current");
    // 이틀에 걸친 일정은 두 날 모두에 보인다.
    expect(screen.getByRole("button", { name: "2026년 11월 20일 (금), 일정 1건" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026년 11월 21일 (토), 일정 1건" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026년 11월 22일 (일)" })).toBeInTheDocument();
  });

  it("opens on today's panel and walks schedule → notes, with event details one tap away", async () => {
    const DETAIL = {
      event: DATA.events[0], people: [], annotations: [], thread: null, materials: [], notes: [],
      scheduleBrief: { mode: null, thread: null, previousEvent: null, previousAnnotation: null, people: [], preparations: [], preparationSuggestions: [], reasonCodes: [] }
    };
    const fetchMock = stubFetch((url) => {
      if (url.startsWith("/api/calendar")) return json(DATA);
      if (url.startsWith("/api/today")) return json(surface());
      if (url === "/api/events/1") return json(DETAIL);
      return json({ notes: [], total: 0, related: [], targets: [] });
    });
    render(<CalendarPage />);

    // 첫 화면: 오늘 패널이 나와 있다.
    const panel = screen.getByRole("complementary", { name: "2026년 11월 12일 (목) 상세" });
    expect(panel).toHaveAttribute("data-open", "true");
    expect(within(panel).getByText("오늘")).toBeInTheDocument();

    // 1단계: 일정 탭 — 시간표와 그날 마감.
    expect(await within(panel).findByRole("tab", { name: /^일정\s*2$/ })).toHaveAttribute("aria-selected", "true");
    const row = within(panel).getByRole("button", { name: "14:00 – 15:00 팀 회의 상세 보기" });
    expect(row).toHaveTextContent("T동 501");
    expect(within(within(panel).getByRole("region", { name: "마감인 할 일" })).getByText("보고서 초안")).toBeInTheDocument();

    // 일정을 누르면 Today 에서 쓰던 일정 상세 시트가 그대로 열린다.
    fireEvent.click(row);
    expect(await screen.findByRole("dialog", { name: "일정 상세" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/events/1")).toBe(true);

    // 메모 탭 — 그날 메모.
    fireEvent.click(within(panel).getByRole("tab", { name: /^메모\s*2$/ }));
    expect(within(panel).getByRole("tab", { name: /^메모\s*2$/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/notes?date=2026-11-12")).toBe(true));
    expect(within(panel).queryByRole("button", { name: /팀 회의 상세 보기/ })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "날짜 상세 닫기" }));
    expect(screen.getByRole("complementary", { name: "2026년 11월 12일 (목) 상세" })).toHaveAttribute("data-open", "false");
  });

  it("toggles the panel by tapping the same date, and the calendar takes the screen while it is away", async () => {
    calendarOnly();
    render(<CalendarPage />);
    const today = await screen.findByRole("button", { name: /11월 12일 \(목\), 오늘/ });
    const page = screen.getByRole("main");
    expect(page).toHaveAttribute("data-panel", "open");
    expect(today).toHaveAttribute("aria-expanded", "true");

    // 같은 날짜를 다시 누르면 들어간다. 선택은 그대로 남아 다시 누르면 나온다.
    fireEvent.click(today);
    expect(page).toHaveAttribute("data-panel", "closed");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(today);
    expect(page).toHaveAttribute("data-panel", "open");

    // 패널이 나와 있을 때 다른 날짜를 누르면 닫히지 않고 그 날짜로 바뀐다.
    fireEvent.click(screen.getByRole("button", { name: "2026년 11월 22일 (일)" }));
    expect(page).toHaveAttribute("data-panel", "open");
    expect(screen.getByRole("complementary", { name: "2026년 11월 22일 (일) 상세" })).toHaveAttribute("data-open", "true");
  });

  it("asks what happened to recent finished events and records the answer in one tap", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    let recorded: number[] = [];
    const data = (): CalendarData => ({
      ...DATA,
      events: [
        ...DATA.events,
        event({ id: 5, title: "어제 스터디", start: "2026-11-11T19:00:00+09:00", end: "2026-11-11T21:00:00+09:00" }),
        event({ id: 6, title: "한 달 전 모임", start: "2026-10-10T19:00:00+09:00", end: "2026-10-10T21:00:00+09:00" })
      ],
      outcomeRecordedEventIds: recorded
    });
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        recorded = [5];
        return Promise.resolve(json({ event: {}, annotations: [] }));
      }
      if (String(url).startsWith("/api/calendar")) return Promise.resolve(json(data()));
      if (String(url).startsWith("/api/today")) return Promise.resolve(json(surface()));
      return Promise.resolve(json({ notes: [], total: 0, related: [] }));
    }));
    render(<CalendarPage />);

    // 종일 일정(생일)이나 오래된 일정은 묻지 않는다.
    expect(await screen.findByRole("button", { name: "2026년 11월 2일 (월), 일정 1건" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2026년 11월 11일 (수), 일정 1건, 결과 기록 1건" }));
    const panel = screen.getByRole("complementary", { name: "2026년 11월 11일 (수) 상세" });
    fireEvent.click(await within(panel).findByRole("tab", { name: /^처리\s*1$/ }));

    const group = within(panel).getByRole("group", { name: "어제 스터디 결과" });
    fireEvent.click(within(group).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(posts).toEqual([{ url: "/api/events/5/outcome", body: { outcome: "done" } }]));

    // 기록하면 달력을 다시 불러와 사라진다.
    await waitFor(() => expect(within(panel).queryByRole("group", { name: "어제 스터디 결과" })).not.toBeInTheDocument());
    expect(within(panel).getByRole("tab", { name: "처리" })).toBeInTheDocument(); // 숫자가 사라진다
    expect(screen.getByRole("button", { name: "2026년 11월 11일 (수), 일정 1건" })).toBeInTheDocument();
  });

  it("brings Today's decision cards and energy into the panel for the chosen day", async () => {
    const TASK = { id: 9, threadId: null, title: "메일 답장", estMinutes: 2, due: null, context: null, status: "todo", optional: 0 };
    const a = event({ id: 21, title: "회의 A" });
    const b = event({ id: 22, title: "회의 B", start: "2026-11-12T14:30:00+09:00", end: "2026-11-12T15:30:00+09:00" });
    const today = surface({
      twoMinuteTasks: [TASK],
      conflicts: [{ a, b }],
      cards: [{ kind: "conflict", pair: { a, b } }, { kind: "two_minute_task", task: TASK }]
    });
    const fetchMock = calendarOnly(DATA, today);
    render(<CalendarPage />);
    const panel = screen.getByRole("complementary", { name: "2026년 11월 12일 (목) 상세" });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/today?date=2026-11-12"))).toBe(true));

    // 처리할 게 있을 때만 숫자가 붙고, 일정 탭에는 카드가 섞이지 않는다.
    const actions = await within(panel).findByRole("tab", { name: /^처리\s*2$/ });
    expect(within(panel).queryByText("메일 답장")).not.toBeInTheDocument();
    fireEvent.click(actions);
    const list = within(panel).getByRole("list", { name: "처리할 것" });
    expect(within(list).getByRole("button", { name: "충돌 해결: 회의 A ↔ 회의 B" })).toBeInTheDocument();
    expect(within(list).getByText("메일 답장")).toBeInTheDocument();

    // 여유 탭: 그날의 에너지 부하.
    fireEvent.click(within(panel).getByRole("tab", { name: "여유" }));
    expect(within(panel).getByRole("meter", { name: /에너지 부하/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("list", { name: "처리할 것" })).not.toBeInTheDocument();
  });

  it("shows only that day's conflicts for a day that is not today", async () => {
    const TASK = { id: 9, threadId: null, title: "메일 답장", estMinutes: 2, due: null, context: null, status: "todo", optional: 0 };
    const a = event({ id: 21, title: "회의 A", start: "2026-11-20T14:00:00+09:00", end: "2026-11-20T15:00:00+09:00" });
    const b = event({ id: 22, title: "회의 B", start: "2026-11-20T14:30:00+09:00", end: "2026-11-20T15:30:00+09:00" });
    calendarOnly(DATA, surface({ date: "2026-11-20", cards: [{ kind: "conflict", pair: { a, b } }, { kind: "two_minute_task", task: TASK }] }));
    render(<CalendarPage />);
    fireEvent.click(await screen.findByRole("button", { name: /11월 20일 \(금\)/ }));
    const panel = screen.getByRole("complementary", { name: "2026년 11월 20일 (금) 상세" });
    fireEvent.click(await within(panel).findByRole("tab", { name: /^처리\s*1$/ }));
    expect(within(panel).getByRole("button", { name: "충돌 해결: 회의 A ↔ 회의 B" })).toBeInTheDocument();
    expect(within(panel).queryByText("메일 답장")).not.toBeInTheDocument();
  });

  it("does not raise conflicts for a day that is already over", async () => {
    const a = event({ id: 21, title: "회의 A", start: "2026-11-05T14:00:00+09:00", end: "2026-11-05T15:00:00+09:00", status: "done" });
    const b = event({ id: 22, title: "회의 B", start: "2026-11-05T14:30:00+09:00", end: "2026-11-05T15:30:00+09:00", status: "done" });
    const fetchMock = calendarOnly(DATA, surface({ date: "2026-11-05", cards: [{ kind: "conflict", pair: { a, b } }] }));
    render(<CalendarPage />);
    fireEvent.click(await screen.findByRole("button", { name: "2026년 11월 5일 (목)" }));
    const panel = screen.getByRole("complementary", { name: "2026년 11월 5일 (목) 상세" });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/today?date=2026-11-05"))).toBe(true));
    fireEvent.click(within(panel).getByRole("tab", { name: "처리" }));
    expect(within(panel).queryByRole("button", { name: /충돌 해결/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("list", { name: "처리할 것" })).not.toBeInTheDocument();
  });

  it("starts a new event on the chosen day from the schedule tab", async () => {
    calendarOnly();
    render(<CalendarPage />);
    fireEvent.click(await screen.findByRole("button", { name: "2026년 11월 22일 (일)" }));
    const panel = screen.getByRole("complementary", { name: "2026년 11월 22일 (일) 상세" });
    fireEvent.click(await within(panel).findByRole("button", { name: "+ 일정·할 일" }));
    const sheet = await screen.findByRole("dialog", { name: "일정 추가" });
    expect(within(sheet).getByDisplayValue("2026-11-22T09:00")).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue("2026-11-22T10:00")).toBeInTheDocument();
  });

  it("shows just the add buttons on an empty day, and starts a note on that day", async () => {
    calendarOnly();
    render(<CalendarPage />);
    fireEvent.click(await screen.findByRole("button", { name: "2026년 11월 22일 (일)" }));
    const panel = screen.getByRole("complementary", { name: "2026년 11월 22일 (일) 상세" });
    // 빈 날에는 안내 문구 없이 추가 버튼만 있다.
    expect(within(panel).queryByRole("list", { name: "일정" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "+ 일정·할 일" })).toBeInTheDocument();
    expect(within(panel).queryByText("오늘")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("tab", { name: "메모" }));
    fireEvent.click(within(panel).getByRole("button", { name: "+ 메모" }));
    const flow = screen.getByRole("dialog", { name: "빠른 기록" });
    fireEvent.change(within(flow).getByLabelText("1번째 줄"), { target: { value: "준비물" } });
    fireEvent.click(within(flow).getByRole("button", { name: "다음: 붙일 곳 →" }));
    expect(within(flow).getByLabelText("메모 날짜")).toHaveValue("2026-11-22");
  });

  it("marks days with candidates and lets one be put on the calendar from the day or the full list", async () => {
    let list = [
      { id: 31, title: "독서 모임", start: "2026-11-12T19:00:00+09:00", end: "2026-11-12T21:00:00+09:00", location: "합정역", online: false, url: null, origin: "gmail", proposedBy: "cairn-agent", note: "출처: 메일: 모임 안내", verdict: "possible", reasons: [], createdAt: "2026-11-11T03:00:00.000Z" },
      { id: 32, title: "온라인 설명회", start: "2026-11-20T14:00:00+09:00", end: null, location: null, online: true, url: "https://example.com/e", origin: "reason", proposedBy: "muse", note: null, verdict: null, reasons: [], createdAt: "2026-11-11T03:00:00.000Z" }
    ];
    const answered: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/inbox/candidates") return Promise.resolve(json({ candidates: list }));
      if (u.startsWith("/api/inbox/") && init?.method === "POST") {
        answered.push(`${u} ${String(init.body)}`);
        list = list.filter((c) => !u.includes(`/${c.id}/`));
        return Promise.resolve(json({ status: "answered" }));
      }
      if (u.startsWith("/api/calendar")) return Promise.resolve(json({ ...DATA, events: [], tasks: [], noteCounts: {} }));
      if (u.startsWith("/api/today")) return Promise.resolve(json(surface()));
      return Promise.resolve(json({ notes: [], total: 0, related: [], targets: [] }));
    }));
    render(<CalendarPage />);

    // 후보가 있는 날은 달력에 표시되고, 그 날의 처리 탭에 나온다.
    expect(await screen.findByRole("button", { name: /11월 20일 \(금\).*일정 후보 있음/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: /처리\s*1/ }));
    const day = screen.getByRole("region", { name: "이 날 일정 후보" });
    expect(within(day).getByText("독서 모임")).toBeInTheDocument();
    expect(within(day).queryByText("온라인 설명회")).not.toBeInTheDocument();
    fireEvent.click(within(day).getByRole("button", { name: "독서 모임 일정에 넣기" }));
    await waitFor(() => expect(answered).toEqual(['/api/inbox/31/answer {"decision":"accept","answeredBy":"web"}']));
    await waitFor(() => expect(screen.queryByText("독서 모임")).not.toBeInTheDocument());

    // 전체 후보는 달력 위의 버튼으로 연다.
    fireEvent.click(screen.getByRole("button", { name: "일정 후보 1건 보기" }));
    const sheet = screen.getByRole("dialog", { name: "일정 후보" });
    expect(within(sheet).getByText(/11월 20일 \(금\) 14:00 · 온라인/)).toBeInTheDocument();
    expect(within(sheet).getByText("출처: 다른 에이전트 · muse")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "원문" })).toHaveAttribute("href", "https://example.com/e");
    fireEvent.click(within(sheet).getByRole("button", { name: "온라인 설명회 버리기" }));
    await waitFor(() => expect(answered[1]).toBe('/api/inbox/32/answer {"decision":"reject","answeredBy":"web"}'));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일정 후보" })).not.toBeInTheDocument());
  });

  it("writes due tasks in the day cell, and keeps finished ones struck through", async () => {
    calendarOnly({
      ...DATA,
      tasks: [
        { id: 9, threadId: null, title: "과제 3 제출", estMinutes: null, due: "2026-11-21", context: null, status: "todo", optional: 0 } as TaskRow,
        { id: 8, threadId: null, title: "과제 2 제출", estMinutes: null, due: "2026-11-14", context: null, status: "done", optional: 0 } as TaskRow
      ]
    });
    render(<CalendarPage />);

    const due = await screen.findByRole("button", { name: "2026년 11월 21일 (토), 일정 1건, 마감인 할 일 1건" });
    expect(within(due).getByText("과제 3 제출")).toHaveClass("calendar-cell-task");
    expect(within(due).getByText("과제 3 제출")).not.toHaveAttribute("data-done");
    // 끝낸 과제도 마감일 칸에 남는다.
    const finished = screen.getByRole("button", { name: "2026년 11월 14일 (토), 끝낸 할 일 1건" });
    expect(within(finished).getByText("과제 2 제출")).toHaveAttribute("data-done", "true");

    fireEvent.click(finished);
    const list = await screen.findByRole("region", { name: "마감인 할 일" });
    expect(within(list).getByText("과제 2 제출").closest("li")).toHaveAttribute("data-status", "done");
    expect(within(list).getByText("완료")).toBeInTheDocument();
    // 끝낸 것은 일정 탭의 숫자에 세지 않는다.
    expect(screen.getByRole("tab", { name: "일정" })).toBeInTheDocument();
  });

  it("moves between months, follows a tapped day outside the month, and comes back to today", async () => {
    const fetchMock = calendarOnly();
    render(<CalendarPage />);
    await screen.findByRole("button", { name: /11월 12일 \(목\), 오늘/ });

    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(screen.getByRole("heading", { name: "2026년 12월" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/calendar?from=2026-11-29&to=2027-01-09")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();

    // 10월 달력 끝에 걸친 11월 날짜를 누르면 11월로 넘어간다.
    fireEvent.click(screen.getByRole("button", { name: /2026년 11월 2일 \(월\)/ }));
    expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /11월 12일 \(목\), 오늘/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens straight onto a linked date", async () => {
    window.history.replaceState(null, "", "/calendar?date=2026-03-12");
    const fetchMock = calendarOnly({ ...DATA, events: [], tasks: [], noteCounts: {} });
    render(<CalendarPage />);
    expect(screen.getByRole("heading", { name: "2026년 3월" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/calendar?from=2026-03-01&to=2026-04-11")).toBe(true);
    expect(screen.getByRole("complementary", { name: "2026년 3월 12일 (목) 상세" })).toHaveAttribute("data-open", "true");
  });

  it("keeps the grid usable and offers retry when loading fails", async () => {
    let fail = true;
    stubFetch((url) => (url.startsWith("/api/calendar") && fail ? json("DB 잠김", false) : url.startsWith("/api/calendar") ? json(DATA) : url.startsWith("/api/today") ? json(surface()) : json({ notes: [] })));
    render(<CalendarPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("달력을 불러오지 못했습니다. DB 잠김");
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    expect(screen.queryByRole("button", { name: "다시 로그인" })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: /11월 12일 \(목\), 오늘, 일정 1건, 마감인 할 일 1건/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a fresh login when the session is the problem", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 401, redirected: false, url: "", json: () => Promise.resolve({}) })));
    render(<CalendarPage />);
    expect(await screen.findByRole("button", { name: "다시 로그인" })).toBeInTheDocument();
  });
});

describe("calendar cell lines", () => {
  const bucket = {
    events: [event({ id: 1, title: "회의" }), event({ id: 2, title: "세미나" })],
    tasks: [
      { id: 8, title: "끝낸 과제", status: "done" } as TaskRow,
      { id: 9, title: "남은 과제", status: "todo" } as TaskRow
    ],
    notes: 0, pending: []
  };

  it("shows events, then open tasks, then finished ones, and folds the rest into +N", () => {
    expect(cellLines(bucket, 4).shown.map((l) => l.title)).toEqual(["회의", "세미나", "남은 과제", "끝낸 과제"]);
    expect(cellLines(bucket, 4).hidden).toBe(0);
    // 다 못 넣으면 한 줄은 "+N" 이 쓴다.
    expect(cellLines(bucket, 3)).toMatchObject({ hidden: 2 });
    expect(cellLines(bucket, 3).shown.map((l) => l.title)).toEqual(["회의", "세미나"]);
    expect(cellLines(bucket, 1)).toMatchObject({ shown: [], hidden: 4 });
    expect(cellLines(bucket, 0)).toMatchObject({ shown: [], hidden: 4 });
  });

  it("fits as many lines as the cell is tall", () => {
    expect(linesThatFit(130, 15)).toBe(5);
    expect(linesThatFit(92, 15)).toBe(3);
    expect(linesThatFit(44, 15)).toBe(0);
    // 아직 잴 수 없으면 세 줄로 둔다.
    expect(linesThatFit(0, 15)).toBe(3);
  });
});
