import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleDirectory } from "./PeopleDirectory.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubDirectory(people: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { people } }) })
  ));
}

function stubDirectoryError() {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "server error" } }) })
  ));
}

function stubAccessError() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(Object.assign(new Error("access"), { kind: "access_session_required" }))));
}

describe("PeopleDirectory", () => {
  it("shows loading indicator initially", () => {
    // Never resolves — stays in loading state
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<PeopleDirectory />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중…");
  });

  it("quiet state when people list is empty", async () => {
    stubDirectory([]);
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByTestId("people-quiet")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "아직 사람이 없어" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "입력 화면으로" })).toHaveAttribute("href", "/input");
  });

  it("live state renders person cards", async () => {
    stubDirectory([
      { id: 1, name: "Alice", relation: "동료", channel: "kakao", hardConstraints: [], totalMeets: 5, lastMet: "2026-06-01T11:00:00+09:00", frequencyBand: "established" },
      { id: 2, name: "Bob", relation: null, channel: "none", hardConstraints: [], totalMeets: 0, lastMet: null, frequencyBand: "cold_start" }
    ]);
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByTestId("people-live")).toBeInTheDocument());
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("동료")).toBeInTheDocument();
    expect(screen.getByText("정기적")).toBeInTheDocument();   // established
    expect(screen.getByText("처음 만남")).toBeInTheDocument(); // cold_start
    // Known lastMet renders a localized date-time; null lastMet uses the explicit fallback.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText("만남 기록 없음")).toBeInTheDocument();
    // Card links point to /people/:id
    expect(screen.getByRole("link", { name: "Alice 상세" })).toHaveAttribute("href", "/people/1");
    expect(screen.getByRole("link", { name: "Bob 상세" })).toHaveAttribute("href", "/people/2");
  });

  it("error state shows message and retry button", async () => {
    stubDirectoryError();
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("server error");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("access_error state shows Access login button", async () => {
    stubAccessError();
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인 세션이 필요해" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument();
  });

  it("retry button re-fetches and recovers to live state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, error: { message: "server error" } }) })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              people: [
                { id: 1, name: "Alice", relation: null, channel: "none", hardConstraints: [], totalMeets: 0, lastMet: null, frequencyBand: "cold_start" },
              ],
            },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByTestId("people-live")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Access 로그인 다시 열기 triggers full-page navigation", async () => {
    stubAccessError();
    const assignMock = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/people", assign: assignMock });
    render(<PeopleDirectory />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Access 로그인 다시 열기" }));
    expect(assignMock).toHaveBeenCalledWith("http://localhost/people");
  });
});
