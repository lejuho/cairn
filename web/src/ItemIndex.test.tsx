import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemIndex } from "./ItemIndex.js";

const EVENT = {
  id: 1,
  threadId: null,
  title: "어딘가에 안 묶인 일정",
  type: null,
  start: null,
  end: null,
  location: null,
  mode: null,
  source: "cairn",
  selfImposed: 1,
  status: "planned",
  schedulePromptDismissedOn: null,
  createdAt: "2026-06-29T01:00:00+09:00",
  updatedAt: "2026-06-29T01:00:00+09:00"
};

const TASK = {
  id: 2,
  threadId: null,
  title: "어딘가에 안 묶인 할 일",
  estMinutes: 15,
  due: null,
  context: null,
  status: "todo",
  optional: 0,
  schedulePromptDismissedOn: null,
  scheduledEventId: null,
  createdAt: "2026-06-29T01:01:00+09:00"
};

const EVENT_DETAIL = {
  event: EVENT,
  people: [],
  annotations: [],
  thread: null,
  scheduleBrief: {
    mode: null,
    thread: null,
    previousEvent: null,
    previousAnnotation: null,
    people: [],
    preparations: [],
    preparationSuggestions: [],
    reasonCodes: []
  }
};

const SLOT_CANDIDATE = {
  start: "2026-06-30T10:00:00+09:00",
  end: "2026-06-30T10:30:00+09:00",
  score: 80,
  rank: 1,
  scoreLabel: "좋음",
  reasons: ["빈 시간"],
  reasonCodes: ["available"],
  contributions: []
};

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ItemIndex", () => {
  it("loads active events and tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }))));

    render(<ItemIndex />);

    expect(screen.getByTestId("items-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());
    expect(screen.getByText("어딘가에 안 묶인 일정")).toBeInTheDocument();
    expect(screen.getByText("어딘가에 안 묶인 할 일")).toBeInTheDocument();
  });

  it("shows time remaining for dated events and tasks", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-29T09:00:00+09:00").getTime());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({
      ok: true,
      data: {
        scope: "active",
        events: [{ ...EVENT, start: "2026-06-30T10:30:00+09:00", end: "2026-06-30T11:00:00+09:00" }],
        tasks: [{ ...TASK, due: "2026-06-29" }]
      }
    }))));

    render(<ItemIndex />);

    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());
    expect(screen.getByText("1일 1시간 30분 남음")).toBeInTheDocument();
    expect(screen.getByText("15시간 남음")).toBeInTheDocument();
  });

  it("switches to all scope", async () => {
    const fetchMock = vi.fn((url: string) => {
      const scope = url.includes("scope=all") ? "all" : "active";
      return Promise.resolve(response({ ok: true, data: { scope, events: [], tasks: [] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-quiet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "전체" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("scope=all"))).toBe(true);
    });
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a retryable error state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({ ok: false, error: { message: "서버 오류" } }))));

    render(<ItemIndex />);

    await waitFor(() => expect(screen.getByTestId("items-error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("opens event detail and patches event status", async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/events/1" && !opts?.method) {
        return Promise.resolve(response({ ok: true, data: EVENT_DETAIL }));
      }
      if (url === "/api/events/1/status" && opts?.method === "PATCH") {
        return Promise.resolve(response({ ok: true, data: { event: { ...EVENT, status: "cancelled" } } }));
      }
      return Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: EVENT.title }));
    const dialog = await screen.findByRole("dialog", { name: "일정 상세" });
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) => url === "/api/events/1/status" && opts?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, opts]) => url === "/api/events/1/status" && opts?.method === "PATCH");
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ status: "cancelled" });
  });

  it("opens event detail, loads slot candidates, and schedules the event", async () => {
    const scheduledEvent = { ...EVENT, start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end };
    let detailCalls = 0;
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/events/1" && !opts?.method) {
        detailCalls += 1;
        return Promise.resolve(response({ ok: true, data: { ...EVENT_DETAIL, event: detailCalls === 1 ? EVENT : scheduledEvent } }));
      }
      if (url.includes("/api/events/1/slot-candidates")) {
        return Promise.resolve(response({ ok: true, data: { candidates: [SLOT_CANDIDATE] } }));
      }
      if (url === "/api/events/1/schedule" && opts?.method === "PATCH") {
        return Promise.resolve(response({ ok: true, data: { event: scheduledEvent } }));
      }
      return Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: EVENT.title }));
    const dialog = await screen.findByRole("dialog", { name: "일정 상세" });
    fireEvent.click(within(dialog).getByRole("button", { name: "시간 추천" }));
    fireEvent.click(await within(dialog).findByTestId("item-event-slot-1"));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) => url === "/api/events/1/schedule" && opts?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, opts]) => url === "/api/events/1/schedule" && opts?.method === "PATCH");
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end });
  });

  it("opens task detail and drops the task", async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/tasks/2/status" && opts?.method === "PATCH") {
        return Promise.resolve(response({ ok: true, data: { ...TASK, status: "dropped" } }));
      }
      return Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: TASK.title }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 상세" });
    fireEvent.click(within(dialog).getByRole("button", { name: "드롭" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) => url === "/api/tasks/2/status" && opts?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, opts]) => url === "/api/tasks/2/status" && opts?.method === "PATCH");
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ status: "dropped" });
  });

  it("edits a due-less task detail so time suggestion becomes available", async () => {
    const updatedTask = { ...TASK, due: "2026-06-30", estMinutes: 25, context: "집중" };
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/tasks/2/thread-node" && opts?.method === "PATCH") {
        return Promise.resolve(response({ ok: true, data: { task: updatedTask } }));
      }
      return Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [TASK] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: TASK.title }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 상세" });
    expect(within(dialog).getByText("마감일을 먼저 넣어야 후보를 계산할 수 있어.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("할 일 마감일"), { target: { value: "2026-06-30" } });
    fireEvent.change(within(dialog).getByLabelText("할 일 예상 분"), { target: { value: "25" } });
    fireEvent.change(within(dialog).getByLabelText("할 일 맥락"), { target: { value: "집중" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) => url === "/api/tasks/2/thread-node" && opts?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, opts]) => url === "/api/tasks/2/thread-node" && opts?.method === "PATCH");
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ due: "2026-06-30", estMinutes: 25, context: "집중" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "시간 추천" })).toBeInTheDocument());
  });

  it("opens due task detail, loads candidates, and creates a schedule block", async () => {
    const dueTask = { ...TASK, due: "2026-06-30" };
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes("/api/tasks/2/slot-candidates")) {
        return Promise.resolve(response({ ok: true, data: { candidates: [SLOT_CANDIDATE] } }));
      }
      if (url === "/api/tasks/2/schedule-block" && opts?.method === "POST") {
        return Promise.resolve(response({ ok: true, data: { task: { ...dueTask, scheduledEventId: 99 }, event: { ...EVENT, id: 99, start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end } } }));
      }
      return Promise.resolve(response({ ok: true, data: { scope: "active", events: [EVENT], tasks: [dueTask] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ItemIndex />);
    await waitFor(() => expect(screen.getByTestId("items-live")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: TASK.title }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 상세" });
    fireEvent.click(within(dialog).getByRole("button", { name: "시간 추천" }));
    fireEvent.click(await within(dialog).findByTestId("item-task-slot-1"));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) => url === "/api/tasks/2/schedule-block" && opts?.method === "POST")).toBe(true));
    const postCall = fetchMock.mock.calls.find(([url, opts]) => url === "/api/tasks/2/schedule-block" && opts?.method === "POST");
    expect(JSON.parse(postCall![1]!.body as string)).toMatchObject({ start: SLOT_CANDIDATE.start, end: SLOT_CANDIDATE.end, days: 7 });
  });
});
