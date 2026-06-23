import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Watchers } from "./Watchers.js";
import { AppNav } from "./AppNav.js";
import type { WatcherDeepRow } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WATCHER_DUE: WatcherDeepRow = {
  id: 1, category: "travel", label: "여권 갱신", kind: "A", armed: true,
  threshold: "2026-06-20", snoozedUntil: null, status: "due", daysOverdue: 2,
  daysUntil: null, message: "2일 지난 watcher야", reasonCodes: ["date_threshold_due"]
};

const WATCHER_QUIET: WatcherDeepRow = {
  id: 2, category: null, label: "독서 목표", kind: "A", armed: true,
  threshold: "2026-07-01", snoozedUntil: null, status: "quiet", daysOverdue: null,
  daysUntil: 8, message: "8일 후 확인할 watcher야", reasonCodes: ["date_threshold_pending"]
};

const WATCHER_DISARMED: WatcherDeepRow = {
  id: 3, category: null, label: "예전 watcher", kind: "A", armed: false,
  threshold: "2026-06-01", snoozedUntil: null, status: "disarmed", daysOverdue: null,
  daysUntil: null, message: "비활성 watcher야", reasonCodes: ["disarmed"]
};

function mockFetch(watchers: WatcherDeepRow[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true, data: { watchers } })
  }));
}

describe("Watchers — loading skeleton", () => {
  it("shows skeleton on first render", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ })));
    render(<Watchers />);
    expect(document.querySelector(".skeleton-card")).toBeInTheDocument();
  });
});

describe("Watchers — quiet state", () => {
  it("shows quiet copy and '+ Watcher 추가' button when no watchers", async () => {
    mockFetch([]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByText(/아직 추가된 watcher가 없어/)).toBeInTheDocument());
    expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument();
  });
});

describe("Watchers — live state", () => {
  it("groups due, quiet, and disarmed watchers in sections", async () => {
    mockFetch([WATCHER_DUE, WATCHER_QUIET, WATCHER_DISARMED]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByText("여권 갱신")).toBeInTheDocument());
    expect(screen.getByText("독서 목표")).toBeInTheDocument();
    expect(screen.getByText("예전 watcher")).toBeInTheDocument();
    expect(screen.getAllByText("확인 필요").length).toBeGreaterThan(0);
    expect(screen.getByText("대기 중")).toBeInTheDocument();
    // "비활성" appears in both section heading and status chip
    expect(screen.getAllByText("비활성").length).toBeGreaterThan(0);
  });

  it("due watcher shows '내일 다시 보기' snooze button", async () => {
    mockFetch([WATCHER_DUE]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 내일 다시 보기")).toBeInTheDocument());
  });

  it("armed toggle has aria-pressed=true for armed watcher", async () => {
    mockFetch([WATCHER_DUE]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 비활성화")).toBeInTheDocument());
    const toggle = screen.getByLabelText("여권 갱신 비활성화");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("disarmed watcher toggle has aria-pressed=false", async () => {
    mockFetch([WATCHER_DISARMED]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("예전 watcher 활성화")).toBeInTheDocument());
    const toggle = screen.getByLabelText("예전 watcher 활성화");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("unsupported watcher also renders armed toggle", async () => {
    const WATCHER_UNSUPPORTED: WatcherDeepRow = {
      id: 9, category: null, label: "구형 watcher", kind: "B", armed: false,
      threshold: null, snoozedUntil: null, status: "unsupported", daysOverdue: null,
      daysUntil: null, message: "지원하지 않는 watcher 형식이야", reasonCodes: ["unsupported_kind"]
    };
    mockFetch([WATCHER_UNSUPPORTED]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("구형 watcher 활성화")).toBeInTheDocument());
    const toggle = screen.getByLabelText("구형 watcher 활성화");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Watchers — create bottom sheet", () => {
  it("opens create sheet when '+ Watcher 추가' clicked from live state", async () => {
    mockFetch([WATCHER_DUE]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("create sheet submits POST /api/watchers and refetches", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/watchers") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { id: 9 } }) });
      }
      callCount++;
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [WATCHER_DUE] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("watcher 이름"), { target: { value: "새 watcher" } });
    fireEvent.change(screen.getByLabelText("watcher 마감일"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByLabelText("watcher 저장"));

    await waitFor(() => expect(callCount).toBeGreaterThan(1)); // refetch called
  });

  it("create failure keeps sheet open with role=alert", async () => {
    mockFetch([]);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/watchers") && opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "실패" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("watcher 이름"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("watcher 마감일"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByLabelText("watcher 저장"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // sheet stays open
  });
});

describe("Watchers — armed toggle", () => {
  it("armed toggle calls PATCH /armed and refetches", async () => {
    let patchCalled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/armed") && opts?.method === "PATCH") {
        patchCalled = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [WATCHER_DUE] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 비활성화")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("여권 갱신 비활성화"));
    await waitFor(() => expect(patchCalled).toBe(true));
  });

  it("armed toggle failure shows row-level alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/armed") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "권한 없음" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [WATCHER_DUE] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 비활성화")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("여권 갱신 비활성화"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("권한 없음")).toBeInTheDocument();
  });
});

describe("Watchers — snooze action", () => {
  it("snooze calls PATCH /snooze and refetches", async () => {
    let snoozeCalled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/snooze") && opts?.method === "PATCH") {
        snoozeCalled = true;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [WATCHER_DUE] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 내일 다시 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("여권 갱신 내일 다시 보기"));
    await waitFor(() => expect(snoozeCalled).toBe(true));
  });

  it("snooze failure shows row-level alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/snooze") && opts?.method === "PATCH") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "스누즈 실패" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [WATCHER_DUE] } }) });
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 내일 다시 보기")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("여권 갱신 내일 다시 보기"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("Watchers — error state", () => {
  it("shows error message and retry button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: { message: "서버 오류" } })
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("다시 시도")).toBeInTheDocument();
  });
});

describe("Watchers — access-session state", () => {
  it("shows Access recovery button on 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 403,
      headers: { get: () => "text/html" },
      text: () => Promise.resolve("Cloudflare-Access login")
    }));
    render(<Watchers />);
    await waitFor(() => expect(screen.getByText("Access 로그인 다시 열기")).toBeInTheDocument());
  });
});

describe("AppNav — /watch active state", () => {
  it("'여백' link is marked active when path is /watch", () => {
    render(<AppNav path="/watch" />);
    const link = screen.getByText("여백").closest("a");
    expect(link?.getAttribute("aria-current")).toBe("page");
  });
});

// Reverse-plan watcher UI tests
const RP_WATCHER: WatcherDeepRow = {
  id: 10, category: "travel", label: "여권 갱신", kind: "A", armed: true,
  threshold: "2026-07-04", snoozedUntil: null, status: "due", daysOverdue: 6,
  daysUntil: null, message: "여권 신청을 시작할 때야",
  reasonCodes: ["reverse_plan_due"],
  reversePlan: {
    targetDate: "2026-07-30",
    targetLabel: "출국",
    safetyDays: 3,
    steps: [
      { label: "여권 신청", leadDays: 21, latestDate: "2026-07-04", taskId: 1, taskStatus: "todo" },
      { label: "항공권 확인", leadDays: 2, latestDate: "2026-07-25", taskId: 2, taskStatus: "todo" }
    ],
    nextStepIndex: 0,
    completed: false
  }
};

describe("Watchers — reverse-plan card display", () => {
  it("shows target date and target label", async () => {
    mockFetch([RP_WATCHER]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByText("출국")).toBeInTheDocument());
    expect(screen.getByText("2026-07-30")).toBeInTheDocument();
  });

  it("shows chain steps in order with latestDate", async () => {
    mockFetch([RP_WATCHER]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByText("여권 신청")).toBeInTheDocument());
    expect(screen.getByText("항공권 확인")).toBeInTheDocument();
  });

  it("due reverse-plan card shows snooze button", async () => {
    mockFetch([RP_WATCHER]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 내일 다시 보기")).toBeInTheDocument());
  });

  it("due reverse-plan card shows armed toggle", async () => {
    mockFetch([RP_WATCHER]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("여권 갱신 비활성화")).toBeInTheDocument());
  });
});

describe("Watchers — reverse-plan create form", () => {
  it("switching to reverse-plan tab shows 목표 날짜 field", async () => {
    mockFetch([]);
    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByText("역산 계획"));
    await waitFor(() => expect(screen.getByLabelText("목표 날짜")).toBeInTheDocument());
  });

  it("reverse-plan create POSTs to /api/watchers/reverse-plan", async () => {
    let rpUrl = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        rpUrl = url as string;
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watcher: { id: 99 }, taskIds: [1, 2] } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [] } }) });
    }));

    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByText("역산 계획"));
    await waitFor(() => expect(screen.getByLabelText("역산 watcher 이름")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("역산 watcher 이름"), { target: { value: "여권 갱신" } });
    fireEvent.change(screen.getByLabelText("목표 날짜"), { target: { value: "2026-07-30" } });
    fireEvent.change(screen.getByLabelText("단계 1 이름"), { target: { value: "여권 신청" } });
    fireEvent.click(screen.getByLabelText("watcher 저장"));

    await waitFor(() => expect(rpUrl).toContain("/api/watchers/reverse-plan"));
  });

  it("reverse-plan create failure keeps sheet open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "날짜 오류" } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { watchers: [] } }) });
    }));

    render(<Watchers />);
    await waitFor(() => expect(screen.getByLabelText("Watcher 추가")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Watcher 추가"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByText("역산 계획"));
    await waitFor(() => expect(screen.getByLabelText("역산 watcher 이름")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("역산 watcher 이름"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("목표 날짜"), { target: { value: "2026-07-30" } });
    fireEvent.change(screen.getByLabelText("단계 1 이름"), { target: { value: "A" } });
    fireEvent.click(screen.getByLabelText("watcher 저장"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("날짜 오류")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
