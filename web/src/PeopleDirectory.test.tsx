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
    expect(screen.getByRole("heading", { name: "사람이 없습니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 사람 추가" })).toBeInTheDocument();
  });

  it("adds a person from this screen and reloads the list", async () => {
    const posts: unknown[] = [];
    let people: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push([String(url), JSON.parse(String(init.body))]);
        people = [{ id: 3, name: "박주현", relation: "지도교수", frequencyBand: "new", totalMeets: 0, lastMet: null }];
        return Promise.resolve({ ok: true, status: 201, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: { person: { id: 3 } } }) });
      }
      return Promise.resolve({ ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: { people } }) });
    }));
    render(<PeopleDirectory />);
    fireEvent.click(await screen.findByRole("button", { name: "+ 사람 추가" }));
    expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: " 박주현 " } });
    fireEvent.change(screen.getByLabelText("관계"), { target: { value: "지도교수" } });
    fireEvent.change(screen.getByLabelText("연락 채널"), { target: { value: "kakao" } });
    fireEvent.click(screen.getByRole("button", { name: "남성" }));
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByRole("link", { name: "박주현 상세" })).toBeInTheDocument();
    expect(posts).toEqual([["/api/people", { displayName: "박주현", channel: "kakao", relation: "지도교수", gender: "male" }]]);
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인이 필요합니다" })).toBeInTheDocument());
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
    expect(assignMock).toHaveBeenCalledWith("/api/session/return?to=%2Fpeople");
  });
});

describe("PeopleDirectory — finding people", () => {
  const person = (id: number, name: string, relation: string | null, groups: string[]) =>
    ({ id, name, relation, groups, channel: "kakao", frequencyBand: "cold_start", totalMeets: 0, lastMet: null });

  it("filters by group chip and by words, and counts what is left", async () => {
    stubDirectory([
      person(1, "구예모", "학회장", ["BAY"]),
      person(2, "이기원", "컴공", ["Team401", "pcrc"]),
      person(3, "왕지우", "10년지기 친구", [])
    ]);
    render(<PeopleDirectory />);
    await screen.findByRole("link", { name: "구예모 상세" });

    const filter = screen.getByRole("group", { name: "묶음으로 거르기" });
    expect(screen.getByRole("group", { name: "보기" })).toHaveTextContent("전체 3");
    expect(filter).toHaveTextContent("모든 묶음");
    fireEvent.click(screen.getByRole("button", { name: "pcrc 1" }));
    expect(screen.getByRole("link", { name: "이기원 상세" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "구예모 상세" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1명");

    fireEvent.click(screen.getByRole("button", { name: "묶음 없음 1" }));
    expect(screen.getByRole("link", { name: "왕지우 상세" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "이기원 상세" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "모든 묶음" }));
    fireEvent.change(screen.getByLabelText("사람 찾기"), { target: { value: "학회장" } });
    expect(screen.getByRole("link", { name: "구예모 상세" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "왕지우 상세" })).not.toBeInTheDocument();
  });
});

describe("PeopleDirectory — who to show first", () => {
  const base = { relation: null, groups: [], channel: "kakao", frequencyBand: "cold_start", totalMeets: 0, lastMet: null };

  it("opens on people with an event around now, soonest first, and shows which event", async () => {
    stubDirectory([
      { ...base, id: 1, name: "지난사람", upcoming: null, recent: { eventId: 5, title: "회고", start: "2026-11-10T19:00:00+09:00" }, pinned: false },
      { ...base, id: 2, name: "먼사람", upcoming: null, recent: null, pinned: true },
      { ...base, id: 3, name: "나중사람", upcoming: { eventId: 7, title: "세미나", start: "2026-11-25T10:00:00+09:00" }, recent: null, pinned: false },
      { ...base, id: 4, name: "곧볼사람", upcoming: { eventId: 6, title: "온보딩 콜", start: "2026-11-19T20:30:00+09:00" }, recent: null, pinned: false }
    ]);
    render(<PeopleDirectory />);

    await screen.findByRole("link", { name: "곧볼사람 상세" });
    expect(screen.getByRole("button", { name: "요즘 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link", { name: /상세$/ }).map((a) => a.getAttribute("aria-label"))).toEqual(["곧볼사람 상세", "나중사람 상세", "지난사람 상세"]);
    expect(screen.getByRole("link", { name: "곧볼사람: 다가오는 일정 온보딩 콜" })).toHaveAttribute("href", "/calendar?date=2026-11-19");
    expect(screen.getByRole("link", { name: "지난사람: 지난 일정 회고" })).toBeInTheDocument();

    // 모아둔 사람과 전체는 따로 본다. 찾기는 어느 보기에서든 전체에서 찾는다.
    fireEvent.click(screen.getByRole("button", { name: "모아둔 1" }));
    expect(screen.getAllByRole("link", { name: /상세$/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "먼사람 상세" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("사람 찾기"), { target: { value: "곧볼" } });
    expect(screen.getByRole("link", { name: "곧볼사람 상세" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1명 · 전체에서 찾음");
  });

  it("opens on everyone when nobody has a nearby event or a pin, and pins with one tap", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push([String(url), JSON.parse(String(init.body))]);
        return Promise.resolve({ ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { people: [{ ...base, id: 1, name: "왕지우", upcoming: null, recent: null, pinned: false }] } }) });
    }));
    render(<PeopleDirectory />);
    await screen.findByRole("link", { name: "왕지우 상세" });
    expect(screen.getByRole("button", { name: "전체 1" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "왕지우 모아두기" }));
    expect(await screen.findByRole("button", { name: "왕지우 모아둔 사람에서 빼기" })).toHaveAttribute("aria-pressed", "true");
    expect(patches).toEqual([["/api/people/1", { pinned: true }]]);
    expect(screen.getByRole("button", { name: "모아둔 1" })).toBeInTheDocument();
  });
});
