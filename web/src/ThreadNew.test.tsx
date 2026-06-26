import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadNew } from "./ThreadNew.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadNew — validation", () => {
  it("submit button disabled when name is empty", () => {
    render(<ThreadNew />);
    const btn = screen.getByLabelText("스레드 만들기 제출");
    expect(btn).toBeDisabled();
  });

  it("submit button enabled when name is non-empty", () => {
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "Project" } });
    expect(screen.getByLabelText("스레드 만들기 제출")).not.toBeDisabled();
  });

  it("does not call fetch when name is blank after trim", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "   " } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ThreadNew — submission", () => {
  it("posts to /api/threads and navigates on success", async () => {
    Object.defineProperty(window, "location", {
      value: { href: "/threads/new" },
      writable: true
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { id: 5 } })
    }));

    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "My Thread" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));

    await waitFor(() => {
      expect(window.location.href).toBe("/threads/5");
    });
    expect((vi.mocked(fetch) as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/threads",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows error and keeps form values on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: { message: "이미 있음" } })
    }));

    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "Dup" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText(/이름/)).toHaveValue("Dup");
  });

  it("shows access-session error on submit when fetch returns 401 and keeps form open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401,
      headers: { get: () => "text/html" },
      redirected: false, url: "/api/threads",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("Cloudflare-Access")
    }));

    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "세션만료" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/로그인 세션이 만료/)).toBeInTheDocument();
    expect(screen.getByLabelText(/이름/)).toHaveValue("세션만료");
  });
});

describe("ThreadNew — natural-language draft (cycle-51)", () => {
  const DRAFT_DATA = {
    thread: { id: 9, name: "파리 여행", kind: "travel", goal: null, definitionOfDone: null, deadline: "2026-06-01", status: "active", createdAt: null },
    events: [{ id: 1, threadId: 9, title: "항공권 예약", type: "travel", start: null, end: null, location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned", createdAt: null, updatedAt: null }],
    tasks: [{ id: 2, threadId: 9, title: "여권 확인", estMinutes: null, due: null, context: null, status: "todo", optional: 0, createdAt: null }],
    nodeLinks: [{ id: 3, kind: "requires", firmness: "soft", source: "inferred", from: { kind: "task", id: 2, title: "여권 확인" }, to: { kind: "event", id: 1, title: "항공권 예약" } }],
    warnings: [{ code: "unknown_date", message: "날짜가 필요해" }]
  };

  it("draft submit posts to /api/threads/draft and shows a success summary with counts/warnings/link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, data: DRAFT_DATA }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText("자연어 초안 설명"), { target: { value: "파리 여행 준비" } });
    fireEvent.click(screen.getByLabelText("초안 만들기 제출"));
    await waitFor(() => expect(screen.getByTestId("thread-draft-success")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith("/api/threads/draft", expect.objectContaining({ method: "POST" }));
    const summary = screen.getByTestId("thread-draft-success");
    expect(summary).toHaveTextContent("이벤트 1");
    expect(summary).toHaveTextContent("작업 1");
    expect(summary).toHaveTextContent("연결 1");
    expect(screen.getByTestId("draft-warning")).toHaveTextContent("날짜가 필요해");
    expect(screen.getByTestId("draft-open-link")).toHaveAttribute("href", "/threads/9");
  });

  it("fires no follow-up confirm/apply/auto action on draft success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, data: DRAFT_DATA }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText("자연어 초안 설명"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("초안 만들기 제출"));
    await waitFor(() => expect(screen.getByTestId("thread-draft-success")).toBeInTheDocument());
    // exactly one POST (the draft); no follow-up request fired
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /확인|승인|일정|적용/ })).not.toBeInTheDocument();
  });

  it("shows a role=alert error when the draft request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: false, error: { message: "초안 생성 실패" } }) }));
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText("자연어 초안 설명"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("초안 만들기 제출"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안 생성 실패"));
    expect(screen.queryByTestId("thread-draft-success")).not.toBeInTheDocument();
  });

  it("draft submit is disabled for blank text and does not call fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    expect(screen.getByLabelText("초안 만들기 제출")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("자연어 초안 설명"), { target: { value: "  " } });
    fireEvent.click(screen.getByLabelText("초안 만들기 제출"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("manual create still posts to /api/threads", async () => {
    Object.defineProperty(window, "location", { value: { href: "/threads/new" }, writable: true });
    const fetchSpy = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, data: { id: 7 } }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "수동" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));
    await waitFor(() => expect(window.location.href).toBe("/threads/7"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/threads", expect.objectContaining({ method: "POST" }));
  });
});
