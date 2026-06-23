import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonDetail } from "./PersonDetail.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    // Known lastMet renders a localized date-time string.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
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
    // Null lastMet keeps the explicit fallback copy.
    expect(screen.getByText("만남 기록 없음")).toBeInTheDocument();
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

  it("retry button re-fetches and recovers to live state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, error: { code: "SERVER_ERROR", message: "db failed" } }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_DIR, recentMeetings: [MEETING_A] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Access 로그인 다시 열기 triggers full-page navigation", async () => {
    stubAccessError();
    const assignMock = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/people/1", assign: assignMock });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Access 로그인 다시 열기" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Access 로그인 다시 열기" }));
    expect(assignMock).toHaveBeenCalledWith("http://localhost/people/1");
  });
});

// ── Ego graph (작은 관계) ─────────────────────────────────────────────────────

const EGO_GRAPH = {
  center: { id: "person:1", type: "person", targetId: 1, label: "Alice", href: "/people/1" },
  nodes: [
    { id: "person:1", type: "person", targetId: 1, label: "Alice", href: "/people/1" },
    { id: "resource:5", type: "resource", targetId: 5, label: "노트북" },
    { id: "event:9", type: "event", targetId: 9, label: "주간 회의", sublabel: "회의" }
  ],
  edges: [
    { from: "person:1", to: "resource:5", kind: "source_person", firmness: "hard" },
    { from: "person:1", to: "event:9", kind: "event_people", firmness: "soft" }
  ],
  truncated: false
};

function stubDetailThenEgo(ego: unknown) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/relations/ego")) {
      return Promise.resolve({ json: () => Promise.resolve(ego) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_DIR, recentMeetings: [] } }) });
  }));
}

describe("PersonDetail ego graph", () => {
  it("does not fetch ego on page load (tap-only)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/relations/ego")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: EGO_GRAPH }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_DIR, recentMeetings: [] } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/api/relations/ego"))).toBe(false);
    expect(screen.getByTestId("person-ego-btn")).toBeInTheDocument();
  });

  it("loads and renders ego nodes on button tap", async () => {
    stubDetailThenEgo({ ok: true, data: EGO_GRAPH });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-ego-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("person-ego-btn"));
    await waitFor(() => expect(screen.getByTestId("person-ego-sheet")).toBeInTheDocument());
    const nodes = screen.getAllByTestId("person-ego-node");
    expect(nodes).toHaveLength(2); // center excluded
    expect(screen.getByText("노트북")).toBeInTheDocument();
    // event node has no href → rendered as plain span, not a link
    expect(screen.queryByRole("link", { name: "주간 회의" })).not.toBeInTheDocument();
    expect(screen.getByText("주간 회의")).toBeInTheDocument();
  });

  it("shows error copy when ego fetch fails", async () => {
    stubDetailThenEgo({ ok: false, error: { message: "boom" } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-ego-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("person-ego-btn"));
    await waitFor(() => expect(screen.getByText("불러오기 실패")).toBeInTheDocument());
  });

  it("renders quiet copy when person has no neighbors", async () => {
    const lonely = { ...EGO_GRAPH, nodes: [EGO_GRAPH.nodes[0]], edges: [] };
    stubDetailThenEgo({ ok: true, data: lonely });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-ego-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("person-ego-btn"));
    await waitFor(() => expect(screen.getByText("연결된 항목 없음")).toBeInTheDocument());
  });
});

// ── Profile display ───────────────────────────────────────────────────────────

const ALICE_WITH_PROFILE = {
  ...ALICE_DIR,
  preferredWindows: { weekdays: ["monday", "wednesday"], periods: ["evening"], firmness: "hard" },
  leadTime: { days: 3, firmness: "hard" }
};

// Fixture without constraint/preferred conflict — for body-value assertions.
const ALICE_FULL_PROFILE = {
  ...ALICE_DIR,
  hardConstraints: [{ type: "weekday_unavailable", weekday: "friday", text: "금 불가", firmness: "hard" }],
  preferredWindows: { weekdays: ["monday", "wednesday"], periods: ["evening"], firmness: "hard" },
  leadTime: { days: 3, firmness: "hard" }
};

describe("PersonDetail — profile display", () => {
  it("shows configured preferred days, periods, channel, lead time", async () => {
    stubDetail({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.getByTestId("profile-preferred-days")).toHaveTextContent("월, 수");
    expect(screen.getByTestId("profile-preferred-periods")).toHaveTextContent("저녁");
    expect(screen.getByTestId("profile-lead-time")).toHaveTextContent("3일 전");
    // channel=kakao shown as 카카오톡
    expect(screen.getByTestId("profile-channel")).toHaveTextContent("카카오톡");
  });

  it("shows 설정 없음 when profile fields are null", async () => {
    stubDetail({
      ok: true,
      data: {
        person: { ...ALICE_DIR, channel: "none", preferredWindows: null, leadTime: null },
        recentMeetings: []
      }
    });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.getByTestId("profile-preferred-days")).toHaveTextContent("설정 없음");
    expect(screen.getByTestId("profile-preferred-periods")).toHaveTextContent("설정 없음");
    expect(screen.getByTestId("profile-lead-time")).toHaveTextContent("설정 없음");
    expect(screen.getByTestId("profile-channel")).toHaveTextContent("설정 없음");
  });
});

// ── Profile editor (bottom sheet) ────────────────────────────────────────────

function stubFetch(firstResponse: unknown, ...rest: unknown[]) {
  let mock = vi.fn().mockResolvedValueOnce({ json: () => Promise.resolve(firstResponse) });
  for (const r of rest) {
    mock = mock.mockResolvedValueOnce({ json: () => Promise.resolve(r) });
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("PersonDetail — profile editor", () => {
  it("프로필 편집 button opens bottom sheet", async () => {
    stubDetail({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
  });

  it("sheet prefills from server PersonRow", async () => {
    stubDetail({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    // Monday toggle should be pressed (in preferred days)
    const mondayToggles = screen.getAllByRole("button", { name: "월" });
    // First 월 is in preferred section, should be pressed
    expect(mondayToggles[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("닫기 button closes sheet without mutation", async () => {
    const fetchMock = stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only initial load, no PUT
  });

  it("Escape closes sheet without mutation", async () => {
    const fetchMock = stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preferred day toggle toggles aria-pressed", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, channel: "none", preferredWindows: null, leadTime: null }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    const tuesdayPref = screen.getAllByRole("button", { name: "화" })[0]!;
    expect(tuesdayPref).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tuesdayPref);
    expect(tuesdayPref).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting a preferred day clears same day from unavailable (mutual exclusion)", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, channel: "none", preferredWindows: null, leadTime: null }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    const allWed = screen.getAllByRole("button", { name: "수" });
    const wedPref = allWed[0]!;
    const wedUnavail = allWed[1]!;
    // [0] = preferred, [1] = unavailable
    fireEvent.click(wedUnavail); // mark wednesday unavailable
    expect(wedUnavail).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(wedPref); // mark wednesday preferred — should clear unavailable
    expect(wedPref).toHaveAttribute("aria-pressed", "true");
    expect(wedUnavail).toHaveAttribute("aria-pressed", "false");
  });

  it("save calls PUT with exact body values and refreshes detail on success", async () => {
    // Uses ALICE_FULL_PROFILE: preferred=[monday,wednesday], unavailable=[friday], no conflict.
    const fetchMock = stubFetch(
      { ok: true, data: { person: ALICE_FULL_PROFILE, recentMeetings: [] } },
      { ok: true, data: { person: ALICE_FULL_PROFILE } },
      { ok: true, data: { person: ALICE_FULL_PROFILE, recentMeetings: [] } }
    );
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putCall = fetchMock.mock.calls[1]!;
    expect(putCall[0]).toContain("/profile");
    const putOpts = putCall[1] as RequestInit;
    expect(putOpts.method).toBe("PUT");
    const body = JSON.parse(putOpts.body as string);
    // Exact values prefilled from ALICE_FULL_PROFILE.
    expect(body.preferredWeekdays).toEqual(["monday", "wednesday"]);
    expect(body.preferredPeriods).toEqual(["evening"]);
    expect(body.leadTimeDays).toBe(3);
    expect(body.channel).toBe("kakao");
    expect(body.unavailableWeekdays).toEqual(["friday"]);
  });

  it("backdrop click closes sheet without mutation", async () => {
    const fetchMock = stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
    // Click directly on the backdrop element (not the sheet content).
    const backdrop = screen.getByTestId("profile-sheet");
    fireEvent.click(backdrop);
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unavailable→preferred mutual exclusion (toggle unavail then same day preferred clears unavail)", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, channel: "none", preferredWindows: null, leadTime: null }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    const allThu = screen.getAllByRole("button", { name: "목" });
    const thuPref = allThu[0]!;
    const thuUnavail = allThu[1]!;
    // Mark thursday unavailable first
    fireEvent.click(thuUnavail);
    expect(thuUnavail).toHaveAttribute("aria-pressed", "true");
    // Mark thursday preferred — unavailable must clear
    fireEvent.click(thuPref);
    expect(thuPref).toHaveAttribute("aria-pressed", "true");
    expect(thuUnavail).toHaveAttribute("aria-pressed", "false");
  });

  it("preferred→unavailable mutual exclusion (toggle preferred then same day unavailable clears preferred)", async () => {
    stubDetail({ ok: true, data: { person: { ...ALICE_DIR, channel: "none", preferredWindows: null, leadTime: null }, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    const allWed = screen.getAllByRole("button", { name: "수" });
    const wedPref = allWed[0]!;
    const wedUnavail = allWed[1]!;
    // Mark wednesday preferred first
    fireEvent.click(wedPref);
    expect(wedPref).toHaveAttribute("aria-pressed", "true");
    // Mark wednesday unavailable — preferred must clear
    fireEvent.click(wedUnavail);
    expect(wedUnavail).toHaveAttribute("aria-pressed", "true");
    expect(wedPref).toHaveAttribute("aria-pressed", "false");
  });

  it("backdrop click is blocked while saving (ISSUE-4)", async () => {
    let resolveSave!: (v: unknown) => void;
    const pendingSave = new Promise((res) => { resolveSave = res; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } }) })
      .mockReturnValueOnce({ json: () => pendingSave });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    // Backdrop click while save pending — sheet must stay open
    const backdrop = screen.getByTestId("profile-sheet");
    fireEvent.click(backdrop);
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
    resolveSave({ ok: true, data: { person: ALICE_WITH_PROFILE } });
  });

  it("focus trap: end sentinel wraps to first dialog button (Tab-forward)", async () => {
    stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    // Sentinels are aria-hidden tabIndex=0 divs inside the backdrop.
    const sentinels = document.querySelectorAll<HTMLDivElement>('[aria-hidden="true"][tabindex="0"]');
    const endSentinel = sentinels[sentinels.length - 1]!;
    fireEvent.focus(endSentinel);
    // First focusable in dialog is the 닫기 button.
    const closeBtn = screen.getByRole("button", { name: "닫기" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("focus trap: start sentinel wraps to last dialog button (Shift+Tab-backward)", async () => {
    stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    const sentinels = document.querySelectorAll<HTMLDivElement>('[aria-hidden="true"][tabindex="0"]');
    const startSentinel = sentinels[0]!;
    fireEvent.focus(startSentinel);
    // Last focusable in dialog is the 취소 button (저장 → 취소 in DOM order).
    const cancelBtn = screen.getByRole("button", { name: "취소" });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("page content is inert while sheet is open (ISSUE-5)", async () => {
    stubDetail({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    expect(screen.getByTestId("page-content")).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    expect(screen.getByTestId("page-content")).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByTestId("page-content")).not.toHaveAttribute("inert");
  });

  it("save failure keeps sheet and shows error", async () => {
    const fetchMock = stubFetch(
      { ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } },
      { ok: false, error: { message: "overlap detected" } }
    );
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("overlap detected");
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("취소 button closes sheet without mutation after failed save", async () => {
    const fetchMock = stubFetch(
      { ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } },
      { ok: false, error: { message: "error" } }
    );
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2); // no third call
  });

  it("닫기 and Escape are blocked while saving (ISSUE-4)", async () => {
    let resolveSave!: (v: unknown) => void;
    const pendingSave = new Promise((res) => { resolveSave = res; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } }) })
      .mockReturnValueOnce({ json: () => pendingSave });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    // Trigger save — fetch hangs
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    // Sheet still open; close button now disabled
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
    // Escape should be blocked
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
    // Resolve the save
    resolveSave({ ok: true, data: { person: ALICE_WITH_PROFILE } });
  });

  it("focus restores to 프로필 편집 button after sheet closes (ISSUE-5)", async () => {
    stubFetch({ ok: true, data: { person: ALICE_WITH_PROFILE, recentMeetings: [] } });
    // Make rAF synchronous so focus-restore fires before assertion.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    render(<PersonDetail id={1} />);
    await waitFor(() => expect(screen.getByTestId("person-live")).toBeInTheDocument());
    const opener = screen.getByRole("button", { name: "프로필 편집" });
    fireEvent.click(opener);
    expect(screen.getByTestId("profile-sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("profile-sheet")).not.toBeInTheDocument();
    // opener should regain focus after close
    expect(document.activeElement).toBe(opener);
  });
});
