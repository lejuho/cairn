import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonDetail } from "./PersonDetail.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubDetail(response: unknown) {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(response) })
  ));
}

function stubAccessError() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(Object.assign(new Error("access"), { kind: "access_session_required" }))));
}

const ALICE_DIR = {
  id: 1, name: "Alice", relation: "동료", channel: "kakao",
  hardConstraints: [{ type: "weekday_unavailable", weekday: "monday", text: "월요일 불가", firmness: "hard" }],
  totalMeets: 3, lastMet: "2026-06-01T11:00:00+09:00", frequencyBand: "established"
};

const MEETING_A = {
  id: 10, title: "점심", start: "2026-06-01T12:00:00+09:00", end: "2026-06-01T13:00:00+09:00",
  source: "cairn", selfImposed: 1, status: "done", threadId: null,
  type: null, location: null, createdAt: "2026-06-01T11:00:00+09:00", updatedAt: "2026-06-01T11:00:00+09:00"
};

describe("PersonDetail", () => {
  it("shows loading indicator initially", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<PersonDetail id={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중…");
  });

  it("live state renders person info and stats", async () => {
    stubDetail({ ok: true, data: { person: ALICE_DIR, recentMeetings: [MEETING_A] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByText("동료")).toBeInTheDocument();
    expect(screen.getByText("3회")).toBeInTheDocument(); // totalMeets
    expect(screen.getByText("정기적")).toBeInTheDocument(); // established
    // hard constraint
    expect(screen.getByText("월요일 불가")).toBeInTheDocument();
    // meeting title
    expect(screen.getByText("점심")).toBeInTheDocument();
    // back link
    expect(screen.getByRole("link", { name: "← 사람 목록" })).toHaveAttribute("href", "/people");
  });

  it("quiet meetings section when no qualifying meetings", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, totalMeets: 0, lastMet: null, frequencyBand: "cold_start" }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.getByText("아직 기록된 만남이 없어.")).toBeInTheDocument();
  });

  it("not_found state when API returns NOT_FOUND", async () => {
    stubDetail({ ok: false, error: { code: "NOT_FOUND", message: "person not found" } });
    render(<PersonDetail id={9999} />);
    await waitFor(() => expect(screen.getByTestId("person-not-found")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "사람 목록으로" })).toHaveAttribute("href", "/people");
  });

  it("error state on generic server error", async () => {
    stubDetail({ ok: false, error: { code: "SERVER_ERROR", message: "db failed" } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("db failed");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("access_error state shows Access login button", async () => {
    stubAccessError();
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인 세션이 필요해" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument();
  });

  it("channel none is not displayed", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, channel: "none" }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.queryByLabelText("연락 채널")).not.toBeInTheDocument();
  });
});
