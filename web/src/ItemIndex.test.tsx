import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
